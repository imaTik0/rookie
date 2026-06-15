import { ProjectRepository } from "./ProjectRepository.ts";
import { FileService } from "./FileService.ts";
import { PromptService } from "./PromptService.ts";
import { Executor } from "./Executor.ts";
import { TestSuiteRepository } from "./TestSuiteRepository.ts";
import { ReportRepository } from "./ReportRepository.ts";
import { ConfigService } from "./ConfigService.ts";
import { Logger } from "../Logger.ts";
import * as types from "../types/index.ts";
import type { DocFile } from "../types/file.ts";
import {
    clusterGaps,
    collectFindings,
    GapCluster,
    taxonomyOf,
    topFailingFunctionsOf,
} from "../feedback/gapAggregate.ts";
import { docExampleLabel, extractDocExamples } from "../feedback/docExamples.ts";
import { tokenOverlap } from "../feedback/fragmentVerify.ts";

export type { DocFile } from "../types/file.ts";

interface StepSummary {
    stepIndex: number;
    description: string;
    status: string;
    error?: string;
    failureAnalysis?: types.report.FailureAnalysis;
}

interface ExecutionReport {
    goal: string;
    status: string;
    reportId: string | null;
    steps: StepSummary[];
}

interface DocExampleResult {
    label: string;
    success: boolean;
    error?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────

export class PlannerService {
    constructor(
        private projectRepository: ProjectRepository,
        private fileService: FileService,
        private promptService: PromptService,
        private executor: Executor,
        private testSuiteRepository: TestSuiteRepository,
        private reportRepository: ReportRepository,
        private configService: ConfigService,
        private logger: Logger,
    ) {}

    // ── Public API ──────────────────────────────────────────────────────────

    public async runMasterPlan(
        projectId: types.project.ProjectId,
        maxGoals: number = 5,
        initialContext: string = "{}",
        onProgress?: (msg: string) => void,
    ) {
        onProgress?.(JSON.stringify({ type: "INIT", projectId }));

        const validFiles = await this.loadProjectFiles(projectId);
        const docExampleResults = await this.runDocExamples(validFiles, onProgress);

        // ── Coverage-driven goal generation ──────────────────────────────────
        const endpointInventory = this.extractEndpointInventory(validFiles);
        onProgress?.(JSON.stringify({
            type: "log",
            content: `Analyzing documentation and generating user goals (${
                endpointInventory ? "with endpoint inventory" : "no inventory"
            })...`,
        }));

        const goals = await this.promptService.promptForUserGoals(
            projectId as string,
            validFiles,
            maxGoals,
            (msg) => {
                onProgress?.(JSON.stringify({ type: "log", content: msg }));
            },
            endpointInventory,
        );

        onProgress?.(JSON.stringify({ type: "GOALS_GENERATED", goals }));

        const { reportIds, executionReports } = await this.executeGoals(
            goals,
            projectId,
            initialContext,
            onProgress,
        );

        return this.aggregateAndSave({
            projectId,
            goals,
            initialContext,
            reportIds,
            executionReports,
            docExampleResults,
            onProgress,
        });
    }

    /**
     * Re-run an existing master plan's goals, optionally against a different project.
     *
     * Unlike `runMasterPlan`, this method:
     *  - Skips goal generation — reuses `masterPlanGoals` from the original report.
     *  - Accepts an optional `projectId` override so the same goals can be run
     *    against a project that has updated / fixed documentation.
     *  - Records `rerunFromMasterPlanId` on the saved report.
     *  - Uses the ORIGINAL plan's gap details as the regression baseline so you can
     *    immediately see which gaps were resolved by the doc fix.
     */
    public async rerunMasterPlan(
        originalMasterPlanId: string,
        overrides: { projectId?: types.project.ProjectId; initialContext?: string } = {},
        onProgress?: (msg: string) => void,
    ) {
        const original = await this.reportRepository.get(
            originalMasterPlanId as types.report.ReportId,
        );
        if (!original || original.type !== "MASTER_PLAN") {
            throw new Error(`Master plan ${originalMasterPlanId} not found`);
        }
        const goals: string[] = original.masterPlanGoals ?? [];
        if (goals.length === 0) {
            throw new Error("Original master plan has no saved goals to re-run");
        }

        const projectId = overrides.projectId ?? original.projectId;
        const initialContext = overrides.initialContext ?? original.initialContext ?? "{}";

        onProgress?.(
            JSON.stringify({ type: "INIT", projectId, rerun: true, originalMasterPlanId }),
        );

        const validFiles = await this.loadProjectFiles(projectId);
        const docExampleResults = await this.runDocExamples(validFiles, onProgress);

        onProgress?.(JSON.stringify({
            type: "GOALS_GENERATED",
            goals,
            note: `Reusing ${goals.length} goals from master plan ${originalMasterPlanId}`,
        }));

        const { reportIds, executionReports } = await this.executeGoals(
            goals,
            projectId,
            initialContext,
            onProgress,
        );

        // Use the original plan's gap details as regression baseline so reruns
        // immediately reflect which gaps were resolved by the doc fix.
        const priorGaps: types.planner.DocumentationGapDetail[] =
            original.structuredSummary?.documentationGapDetails ?? [];

        return this.aggregateAndSave({
            projectId,
            goals,
            initialContext,
            reportIds,
            executionReports,
            docExampleResults,
            priorGaps,
            rerunFromMasterPlanId: originalMasterPlanId,
            onProgress,
        });
    }

    // ── Private: file loading ───────────────────────────────────────────────

    private async loadProjectFiles(projectId: types.project.ProjectId): Promise<DocFile[]> {
        const project = await this.projectRepository.get(projectId);
        if (!project) throw new Error("Project not found");

        const files = await Promise.all(
            project.files.map((fileId) => this.fileService.downloadFile(fileId)),
        );
        const validFiles = files.filter((f): f is NonNullable<typeof f> => !!f) as DocFile[];
        if (validFiles.length === 0) {
            throw new Error("No documentation files found for this project.");
        }
        return validFiles;
    }

    // ── Private: doc-example smoke test ────────────────────────────────────

    /** Run up to 10 fenced code examples from the docs in parallel. */
    private async runDocExamples(
        files: DocFile[],
        onProgress?: (msg: string) => void,
    ): Promise<DocExampleResult[]> {
        const docExamples = extractDocExamples(files);
        if (docExamples.length === 0) return [];

        const capped = docExamples.slice(0, 10);
        onProgress?.(
            JSON.stringify({
                type: "log",
                content: `Running ${capped.length} documentation code examples...`,
            }),
        );

        const results = await Promise.all(
            capped.map(async (ex): Promise<DocExampleResult> => {
                const label = docExampleLabel(ex);
                try {
                    const result = await this.executor.runDocExample(ex.code);
                    onProgress?.(JSON.stringify({
                        type: "log",
                        content: `Doc example [${label}]: ${result.success ? "PASS" : "FAIL"}`,
                    }));
                    return { label, success: result.success, error: result.error };
                } catch {
                    onProgress?.(
                        JSON.stringify({
                            type: "log",
                            content: `Doc example [${label}]: FAIL (executor error)`,
                        }),
                    );
                    return { label, success: false, error: "Executor error" };
                }
            }),
        );

        return results;
    }

    // ── Private: goal execution ─────────────────────────────────────────────

    /**
     * Execute a list of goals in configurable-size batches.
     *
     * Within a batch all goals start with the same KB snapshot. After the full
     * batch completes its findings are merged into the KB for the next batch.
     * This preserves most cross-goal knowledge benefit while reducing wall-clock
     * time proportionally to batch size.
     */
    private async executeGoals(
        goals: string[],
        projectId: types.project.ProjectId,
        initialContext: string,
        onProgress?: (msg: string) => void,
    ): Promise<{ reportIds: types.report.ReportId[]; executionReports: ExecutionReport[] }> {
        const kbLines: string[] = ["# Shared Knowledge Base (prior goal findings)\n"];
        const reportIds: types.report.ReportId[] = [];
        const executionReports: ExecutionReport[] = [];

        const parallelGoals = this.configService.values.planner.parallelGoals;

        const runOneGoal = async (goal: string, index: number): Promise<void> => {
            onProgress?.(JSON.stringify({ type: "GOAL_START", goal, index, total: goals.length }));

            // Snapshot KB at the moment this goal starts (consistent within a batch).
            let goalWithKb = goal;
            if (kbLines.length > 1) {
                const kbSummary = kbLines.slice(0, 30).join("\n");
                goalWithKb = `${goal}\n\n## Prior findings (for context only)\n${kbSummary}`;
            }

            const testSuite = await this.testSuiteRepository.create({
                projectId,
                initialContext,
                minimalStoryLength: 1,
                maximalStoryLength: 3,
                mode: "CODE_GENERATION",
                userGoal: goalWithKb,
            });

            const report = await this.executor.executeTestSuite(
                testSuite._id as types.test.TestSuiteId,
                (msg) => {
                    onProgress?.(JSON.stringify({ type: "GOAL_PROGRESS", goal, log: msg }));
                },
            );

            if (report) {
                reportIds.push(report._id as types.report.ReportId);
                const stepSummary: StepSummary[] = report.steps.map((s) => ({
                    stepIndex: s.stepIndex,
                    description: s.stepDescription,
                    status: s.status,
                    error: s.error?.substring(0, 400),
                    failureAnalysis: s.failureAnalysis,
                }));
                executionReports.push({
                    goal,
                    status: report.status,
                    reportId: report._id as string,
                    steps: stepSummary,
                });

                // Accumulate KB findings — written after each goal completes so
                // they're visible to the next batch but not to concurrent siblings.
                const failedSteps = stepSummary.filter(
                    (s) => s.status === "FAILED" && s.failureAnalysis,
                );
                if (failedSteps.length > 0) {
                    kbLines.push(`\n## Goal: ${goal}`);
                    for (const s of failedSteps.slice(0, 3)) {
                        const fa = s.failureAnalysis!;
                        kbLines.push(
                            `- **${fa.documentationGap}** in \`${fa.failedFunction}\`: ${
                                fa.reasoning.slice(0, 200)
                            }`,
                        );
                        if (fa.suggestedDocsFix) {
                            kbLines.push(`  Fix: ${fa.suggestedDocsFix.slice(0, 150)}`);
                        }
                    }
                }
                onProgress?.(
                    JSON.stringify({
                        type: "GOAL_COMPLETE",
                        goal,
                        status: report.status,
                        reportId: report._id,
                    }),
                );
            } else {
                executionReports.push({ goal, status: "FAILED", reportId: null, steps: [] });
                onProgress?.(
                    JSON.stringify({
                        type: "GOAL_COMPLETE",
                        goal,
                        status: "FAILED",
                        reportId: null,
                    }),
                );
            }

            await this.testSuiteRepository.delete(testSuite._id as types.test.TestSuiteId);
        };

        for (let batchStart = 0; batchStart < goals.length; batchStart += parallelGoals) {
            const batch = goals.slice(batchStart, batchStart + parallelGoals);
            await Promise.all(batch.map((goal, j) => runOneGoal(goal, batchStart + j)));
        }

        return { reportIds, executionReports };
    }

    // ── Private: aggregation, summary, save ────────────────────────────────

    private async aggregateAndSave(opts: {
        projectId: types.project.ProjectId;
        goals: string[];
        initialContext: string;
        reportIds: types.report.ReportId[];
        executionReports: ExecutionReport[];
        docExampleResults: DocExampleResult[];
        priorGaps?: types.planner.DocumentationGapDetail[];
        rerunFromMasterPlanId?: string;
        onProgress?: (msg: string) => void;
    }) {
        const {
            projectId,
            goals,
            initialContext,
            reportIds,
            executionReports,
            docExampleResults,
            priorGaps,
            rerunFromMasterPlanId,
            onProgress,
        } = opts;

        const findings = collectFindings(executionReports);
        const clusters = clusterGaps(findings);
        const regressionMap = await this.computeRegressionStatus(projectId, clusters, priorGaps);

        onProgress?.(
            JSON.stringify({ type: "log", content: "Generating final master summary..." }),
        );
        const { structured, markdown } = await this.promptService.promptForMasterSummary(
            executionReports,
            clusters,
        );

        // Override LLM-derived figures with deterministic ones.
        const successGoals = executionReports.filter((r) => r.status === "SUCCESS").length;
        structured.overallPassRate = goals.length === 0 ? 0 : successGoals / goals.length;
        structured.failureTaxonomy = taxonomyOf(findings);
        structured.topFailingFunctions = topFailingFunctionsOf(findings);
        structured.documentationGapDetails = clusters.map((c) => ({
            fragment: c.fragment,
            proposedFix: c.proposedFix,
            affectedGoals: c.affectedGoals,
            file: c.file,
            documentationGap: c.documentationGap,
            lineStart: c.lineStart,
            lineEnd: c.lineEnd,
            verified: c.verified,
            occurrences: c.occurrences,
            meanConfidence: c.meanConfidence,
            regressionStatus: regressionMap.get(c.key) ?? "NEW",
        }));
        const llmFindingsByGoal = new Map(
            (structured.goalsBreakdown ?? []).map((g) => [g.goal, g.keyFindings]),
        );
        structured.goalsBreakdown = executionReports.map((r) => ({
            goal: r.goal,
            status: r.status,
            reportId: r.reportId as types.report.ReportId | null,
            keyFindings: llmFindingsByGoal.get(r.goal) ?? "",
        }));

        onProgress?.(JSON.stringify({ type: "SUMMARY_GENERATED", summary: markdown, structured }));

        const masterPlan = await this.reportRepository.create({
            projectId,
            status: "SUCCESS",
            type: "MASTER_PLAN",
            initialContext,
            executionPlan: {
                docExampleResults: docExampleResults.length > 0 ? docExampleResults : undefined,
            },
            steps: [],
            detailedResults: { finalOutput: markdown },
            masterPlanGoals: goals,
            masterPlanReports: reportIds,
            structuredSummary: structured,
            rerunFromMasterPlanId,
        } as any);

        await Promise.all(
            reportIds.map((rid) =>
                this.reportRepository.setMasterPlanId(rid, masterPlan._id as string)
            ),
        );

        const label = rerunFromMasterPlanId ? "re-run" : "execution";
        onProgress?.(JSON.stringify({ type: "log", content: `Master Plan ${label} completed.` }));
        return masterPlan;
    }

    // ── Private: regression tracking ───────────────────────────────────────

    /**
     * Compare current gap clusters against a prior run.
     * Returns a map of clusterKey → regressionStatus.
     * When `explicitPriorGaps` is provided (rerun flow) those are used directly;
     * otherwise the most recent MASTER_PLAN for the project is queried.
     */
    private async computeRegressionStatus(
        projectId: types.project.ProjectId,
        currentClusters: GapCluster[],
        explicitPriorGaps?: types.planner.DocumentationGapDetail[],
    ): Promise<Map<string, "NEW" | "PERSISTED">> {
        const result = new Map<string, "NEW" | "PERSISTED">();
        if (currentClusters.length === 0) return result;

        try {
            let priorGaps: types.planner.DocumentationGapDetail[];

            if (explicitPriorGaps) {
                priorGaps = explicitPriorGaps;
            } else {
                const { reports: recent } = await this.reportRepository.listSlim(
                    { page: 1, limit: 5 },
                    { projectId, type: "MASTER_PLAN" },
                );
                const priorReport = recent[0];
                if (!priorReport) return result;
                priorGaps = (priorReport as any).structuredSummary?.documentationGapDetails ?? [];
            }

            for (const cluster of currentClusters) {
                const isPersisted = priorGaps.some((pg) => this.gapsSimilar(cluster, pg));
                result.set(cluster.key, isPersisted ? "PERSISTED" : "NEW");
            }
        } catch (err) {
            this.logger.error(err, "Regression tracking failed (non-fatal)");
        }
        return result;
    }

    /** Fuzzy match two gap descriptions to detect persistence across runs. */
    private gapsSimilar(
        cluster: GapCluster,
        prior: types.planner.DocumentationGapDetail,
    ): boolean {
        // Same file + overlapping lines (strictly overlapping — adjacent ranges share
        // only a single endpoint and are different gaps, so use > 0 not >= 0).
        if (cluster.file && prior.file && cluster.file === prior.file) {
            if (
                cluster.lineStart !== undefined && cluster.lineEnd !== undefined &&
                prior.lineStart !== undefined && prior.lineEnd !== undefined
            ) {
                const overlap = Math.min(cluster.lineEnd, prior.lineEnd) -
                    Math.max(cluster.lineStart, prior.lineStart);
                if (overlap > 0) return true;
            }
        }
        // Fragment text similarity
        if (cluster.fragment && prior.fragment) {
            if (tokenOverlap(cluster.fragment, prior.fragment) >= 0.5) return true;
        }
        // Same failed function + gap category
        if (
            cluster.failedFunction && prior.fragment &&
            cluster.documentationGap === prior.documentationGap &&
            prior.fragment.includes(cluster.failedFunction)
        ) return true;
        return false;
    }

    // ── Private: endpoint inventory ─────────────────────────────────────────

    /**
     * Build a concise endpoint/function inventory from project documentation.
     * Used to steer goal generation toward thorough coverage.
     */
    private extractEndpointInventory(files: DocFile[]): string | undefined {
        const lines: string[] = [];
        const dec = new TextDecoder();

        for (const file of files) {
            const fn = file.metadata.filename;

            // OpenAPI JSON: parse paths
            if (fn.endsWith(".json")) {
                try {
                    const content = dec.decode(file.buffer);
                    const obj = JSON.parse(content) as Record<string, unknown>;
                    if (obj.paths && (obj.openapi || obj.swagger)) {
                        const paths = obj.paths as Record<string, Record<string, unknown>>;
                        for (const [apiPath, methods] of Object.entries(paths)) {
                            for (const [method, def] of Object.entries(methods)) {
                                if (["parameters", "summary", "description"].includes(method)) {
                                    continue;
                                }
                                const d = def as Record<string, unknown>;
                                const summary = (d?.summary || d?.description || "") as string;
                                lines.push(
                                    `- ${method.toUpperCase()} ${apiPath}${
                                        summary ? ` — ${summary.slice(0, 80)}` : ""
                                    }`,
                                );
                            }
                        }
                        continue;
                    }
                } catch { /* not valid JSON */ }
            }

            // Markdown: extract lines that look like API endpoint headings
            if (fn.endsWith(".md") || fn.endsWith(".mdx") || fn.endsWith(".txt")) {
                const content = dec.decode(file.buffer);
                for (const line of content.split("\n")) {
                    if (
                        line.match(/^#{1,4}\s.*(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/i) ||
                        line.match(/^#{1,4}\s.*\/[a-z]/i)
                    ) {
                        lines.push(`- ${line.replace(/^#{1,4}\s+/, "").slice(0, 100)}`);
                    }
                }
            }
        }

        if (lines.length === 0) return undefined;
        return lines.slice(0, 100).join("\n");
    }
}
