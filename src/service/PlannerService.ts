import { Injectable } from "../ioc/decorator.ts";
import { ProjectRepository } from "../db/mongo/ProjectRepository.ts";
import { FileService } from "./FileService.ts";
import { PromptService } from "./PromptService.ts";
import { Executor } from "./Executor.ts";
import { TestSuiteRepository } from "../db/mongo/TestSuiteRepository.ts";
import { ReportRepository } from "../db/mongo/ReportRepository.ts";
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
    docsFaithful?: boolean;
    docsUnfaithfulMissing?: string[];
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

export function selectGoals(savedGoals: string[], goalIndices?: number[]): string[] {
    if (!goalIndices) return savedGoals;
    const picked = [...new Set(goalIndices)]
        .filter((i) => Number.isInteger(i) && i >= 0 && i < savedGoals.length)
        .sort((a, b) => a - b);
    if (picked.length === 0) {
        throw new Error(
            `goalIndices ${JSON.stringify(goalIndices)} selects none of the ` +
                `${savedGoals.length} saved goals`,
        );
    }
    return picked.map((i) => savedGoals[i]);
}

@Injectable()
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

    public async runMasterPlan(
        projectId: types.project.ProjectId,
        maxGoals: number = 5,
        initialContext: string = "{}",
        onProgress?: (msg: string) => void,
        packageOverrides?: Record<string, string>,
        changelogSeed?: string,
        withoutDocs?: boolean,
        expectedApis?: string[],
    ) {
        onProgress?.(JSON.stringify({ type: "INIT", projectId }));

        const validFiles = await this.loadProjectFiles(projectId);
        const docExampleResults = await this.runDocExamples(
            validFiles,
            onProgress,
            packageOverrides,
        );

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
            changelogSeed,
        );

        onProgress?.(JSON.stringify({ type: "GOALS_GENERATED", goals }));

        const { reportIds, executionReports } = await this.executeGoals(
            goals,
            projectId,
            initialContext,
            onProgress,
            packageOverrides,
            { withoutDocs, expectedApis },
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

    public async rerunMasterPlan(
        originalMasterPlanId: string,
        overrides: {
            projectId?: types.project.ProjectId;
            initialContext?: string;
            goalIndices?: number[];
            skipDocExamples?: boolean;
            packageOverrides?: Record<string, string>;
            freeze?: boolean;
            withoutDocs?: boolean;
            expectedApis?: string[];
        } = {},
        onProgress?: (msg: string) => void,
    ) {
        const original = await this.reportRepository.get(
            originalMasterPlanId as types.report.ReportId,
        );
        if (!original || original.type !== "MASTER_PLAN") {
            throw new Error(`Master plan ${originalMasterPlanId} not found`);
        }
        const savedGoals: string[] = original.masterPlanGoals ?? [];
        if (savedGoals.length === 0) {
            throw new Error("Original master plan has no saved goals to re-run");
        }
        const goals = selectGoals(savedGoals, overrides.goalIndices);

        const projectId = overrides.projectId ?? original.projectId;
        const initialContext = overrides.initialContext ?? original.initialContext ?? "{}";

        onProgress?.(
            JSON.stringify({ type: "INIT", projectId, rerun: true, originalMasterPlanId }),
        );

        const validFiles = await this.loadProjectFiles(projectId);
        const docExampleResults = overrides.skipDocExamples
            ? []
            : await this.runDocExamples(validFiles, onProgress, overrides.packageOverrides);

        onProgress?.(JSON.stringify({
            type: "GOALS_GENERATED",
            goals,
            note: goals.length === savedGoals.length
                ? `Reusing ${goals.length} goals from master plan ${originalMasterPlanId}`
                : `Reusing ${goals.length}/${savedGoals.length} goals (goalIndices subset) ` +
                    `from master plan ${originalMasterPlanId}`,
        }));

        const frozenByGoal = overrides.freeze
            ? await this.loadFrozenPrograms(original, goals, onProgress)
            : undefined;

        const { reportIds, executionReports } = await this.executeGoals(
            goals,
            projectId,
            initialContext,
            onProgress,
            overrides.packageOverrides,
            {
                withoutDocs: overrides.withoutDocs,
                expectedApis: overrides.expectedApis,
                frozenByGoal,
            },
        );

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

    private async loadFrozenPrograms(
        original: { structuredSummary?: types.planner.StructuredMasterSummary },
        goals: string[],
        onProgress?: (msg: string) => void,
    ): Promise<Map<string, string[]>> {
        const map = new Map<string, string[]>();
        const byGoal = new Map(
            (original.structuredSummary?.goalsBreakdown ?? []).map((g) => [g.goal, g.reportId]),
        );
        for (const goal of goals) {
            const rid = byGoal.get(goal);
            if (!rid) continue;
            try {
                const rep = await this.reportRepository.get(rid as types.report.ReportId);
                const programs = (rep?.steps ?? [])
                    .map((s) => s.scriptContent)
                    .filter((c): c is string => typeof c === "string" && c.length > 0);
                if (programs.length > 0) map.set(goal, programs);
            } catch { /* missing report → that goal regenerates normally */ }
        }
        onProgress?.(JSON.stringify({
            type: "log",
            content: `Freeze: loaded baseline programs for ${map.size}/${goals.length} goals.`,
        }));
        return map;
    }

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

    private async runDocExamples(
        files: DocFile[],
        onProgress?: (msg: string) => void,
        packageOverrides?: Record<string, string>,
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
                    const result = await this.executor.runDocExample(ex.code, packageOverrides);
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

    private async executeGoals(
        goals: string[],
        projectId: types.project.ProjectId,
        initialContext: string,
        onProgress?: (msg: string) => void,
        packageOverrides?: Record<string, string>,
        opts: {
            /** Docs-ablation arm: generate without documentation (no RAG). */
            withoutDocs?: boolean;
            expectedApis?: string[];
            frozenByGoal?: Map<string, string[]>;
        } = {},
    ): Promise<{ reportIds: types.report.ReportId[]; executionReports: ExecutionReport[] }> {
        const kbLines: string[] = ["# Shared Knowledge Base (prior goal findings)\n"];
        const reportIds: types.report.ReportId[] = [];
        const executionReports: ExecutionReport[] = [];

        const parallelGoals = this.configService.values.planner.parallelGoals;

        const runOneGoal = async (goal: string, index: number): Promise<void> => {
            onProgress?.(JSON.stringify({ type: "GOAL_START", goal, index, total: goals.length }));

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
                packageOverrides,
                withoutDocs: opts.withoutDocs,
                expectedApis: opts.expectedApis,
                frozenPrograms: opts.frozenByGoal?.get(goal),
            });

            let report: Awaited<ReturnType<typeof this.executor.executeTestSuite>> = null;
            try {
                report = await this.executor.executeTestSuite(
                    testSuite._id as types.test.TestSuiteId,
                    (msg) => {
                        onProgress?.(JSON.stringify({ type: "GOAL_PROGRESS", goal, log: msg }));
                    },
                );
            } catch (err) {
                this.logger.error(err, `Goal failed (non-fatal): ${goal.slice(0, 80)}`);
            }

            if (report) {
                reportIds.push(report._id as types.report.ReportId);
                const stepSummary: StepSummary[] = report.steps.map((s) => ({
                    stepIndex: s.stepIndex,
                    description: s.stepDescription,
                    status: s.status,
                    error: s.error?.substring(0, 400),
                    failureAnalysis: s.failureAnalysis,
                    docsFaithful: s.docsFaithful,
                    docsUnfaithfulMissing: s.docsUnfaithfulMissing,
                }));
                executionReports.push({
                    goal,
                    status: report.status,
                    reportId: report._id as string,
                    steps: stepSummary,
                });

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

        const faithfulness = this.summariseFaithfulness(executionReports);
        if (faithfulness) {
            onProgress?.(JSON.stringify({
                type: "log",
                content:
                    `Docs-faithfulness: ${faithfulness.faithfulSteps}/${faithfulness.checkedSteps}` +
                    ` steps used a documented API; ${faithfulness.dodgedGoals.length} goal(s) dodged.`,
            }));
        }

        const masterPlan = await this.reportRepository.create({
            projectId,
            status: "SUCCESS",
            type: "MASTER_PLAN",
            initialContext,
            executionPlan: {
                docExampleResults: docExampleResults.length > 0 ? docExampleResults : undefined,
                faithfulness,
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

    private summariseFaithfulness(executionReports: ExecutionReport[]): {
        checkedSteps: number;
        faithfulSteps: number;
        dodgedSteps: number;
        dodgedGoals: string[];
    } | undefined {
        let checkedSteps = 0;
        let faithfulSteps = 0;
        const dodgedGoals: string[] = [];
        for (const r of executionReports) {
            const checked = r.steps.filter((s) => s.docsFaithful !== undefined);
            if (checked.length === 0) continue;
            checkedSteps += checked.length;
            faithfulSteps += checked.filter((s) => s.docsFaithful).length;
            if (r.status === "SUCCESS" && !checked.some((s) => s.docsFaithful)) {
                dodgedGoals.push(r.goal);
            }
        }
        if (checkedSteps === 0) return undefined;
        return {
            checkedSteps,
            faithfulSteps,
            dodgedSteps: checkedSteps - faithfulSteps,
            dodgedGoals,
        };
    }

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

    private gapsSimilar(
        cluster: GapCluster,
        prior: types.planner.DocumentationGapDetail,
    ): boolean {
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
        if (cluster.fragment && prior.fragment) {
            if (tokenOverlap(cluster.fragment, prior.fragment) >= 0.5) return true;
        }
        if (
            cluster.failedFunction && prior.fragment &&
            cluster.documentationGap === prior.documentationGap &&
            prior.fragment.includes(cluster.failedFunction)
        ) return true;
        return false;
    }

    private extractEndpointInventory(files: DocFile[]): string | undefined {
        const lines: string[] = [];
        const dec = new TextDecoder();

        for (const file of files) {
            const fn = file.metadata.filename;

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
