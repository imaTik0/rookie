import { ProjectRepository } from "./ProjectRepository.ts";
import { FileService } from "./FileService.ts";
import { PromptService } from "./PromptService.ts";
import { Executor } from "./Executor.ts";
import { TestSuiteRepository } from "./TestSuiteRepository.ts";
import { ReportRepository } from "./ReportRepository.ts";
import * as types from "../types/index.ts";
import {
    clusterGaps,
    collectFindings,
    GapCluster,
    taxonomyOf,
    topFailingFunctionsOf,
} from "../feedback/gapAggregate.ts";
import { extractDocExamples, docExampleLabel } from "../feedback/docExamples.ts";
import { tokenOverlap } from "../feedback/fragmentVerify.ts";

export class PlannerService {
    constructor(
        private projectRepository: ProjectRepository,
        private fileService: FileService,
        private promptService: PromptService,
        private executor: Executor,
        private testSuiteRepository: TestSuiteRepository,
        private reportRepository: ReportRepository,
    ) {}

    public async runMasterPlan(projectId: types.project.ProjectId, maxGoals: number = 5, initialContext: string = "{}", onProgress?: (msg: string) => void) {
        onProgress?.(JSON.stringify({ type: "INIT", projectId }));

        // 1. Fetch project files
        const project = await this.projectRepository.get(projectId);
        if (!project) throw new Error("Project not found");

        const files = await Promise.all(
            project.files.map((fileId) => this.fileService.downloadFile(fileId)),
        );
        const validFiles = files.filter((f): f is NonNullable<typeof f> => !!f);

        if (validFiles.length === 0) {
            throw new Error("No documentation files found for this project.");
        }

        // ── #17 Doc-examples smoke test ──────────────────────────────────────
        // Run fenced JS/TS code examples found in the docs before goal execution.
        // Failures here are cheap, high-signal indicators of broken examples.
        const docExamples = extractDocExamples(validFiles);
        if (docExamples.length > 0) {
            onProgress?.(JSON.stringify({ type: "log", content: `Running ${docExamples.length} documentation code examples...` }));
        }
        const docExampleResults: { label: string; success: boolean; error?: unknown }[] = [];
        for (const ex of docExamples.slice(0, 10)) { // cap at 10 per run
            const label = docExampleLabel(ex);
            try {
                const result = await this.executor.runDocExample(ex.code);
                docExampleResults.push({ label, success: result.success, error: result.error });
                onProgress?.(JSON.stringify({
                    type: "log",
                    content: `Doc example [${label}]: ${result.success ? "PASS" : "FAIL"}`,
                }));
            } catch {
                docExampleResults.push({ label, success: false, error: "Executor error" });
            }
        }

        // ── #20 Coverage-driven goal generation ──────────────────────────────
        // Extract endpoint inventory so the goal-generation agent can maximise coverage.
        const endpointInventory = this.extractEndpointInventory(validFiles);
        onProgress?.(JSON.stringify({
            type: "log",
            content: `Analyzing documentation and generating user goals (${endpointInventory ? "with endpoint inventory" : "no inventory"})...`,
        }));

        // ── #22 Cross-goal KB: shared knowledge file ─────────────────────────
        // After each goal we append key findings to a synthetic KB file that
        // subsequent goals receive alongside the project documentation.
        const kbLines: string[] = ["# Shared Knowledge Base (prior goal findings)\n"];

        // 2. Generate user goals
        const goals = await this.promptService.promptForUserGoals(
            project._id as string,
            validFiles,
            maxGoals,
            (msg) => { onProgress?.(JSON.stringify({ type: "log", content: msg })); },
            endpointInventory,
        );

        onProgress?.(JSON.stringify({ type: "GOALS_GENERATED", goals }));

        const reportIds: types.report.ReportId[] = [];
        const executionReports: any[] = [];

        // 3. Execute a TestSuite for each goal
        for (let i = 0; i < goals.length; i++) {
            const goal = goals[i];
            onProgress?.(JSON.stringify({ type: "GOAL_START", goal, index: i, total: goals.length }));

            // ── #22 Inject accumulated KB into the goal prompt ────────────────
            // Prior-goal findings are appended to the user goal so the research
            // agent is aware of already-discovered gaps and can avoid revisiting
            // the same ground or build on what was learned.
            let goalWithKb = goal;
            if (kbLines.length > 1) {
                const kbSummary = kbLines.slice(0, 30).join("\n"); // cap to avoid huge prompts
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
                (msg) => { onProgress?.(JSON.stringify({ type: "GOAL_PROGRESS", goal, log: msg })); },
            );

            if (report) {
                reportIds.push(report._id as types.report.ReportId);
                const stepSummary = report.steps.map((s: any) => ({
                    stepIndex: s.stepIndex,
                    description: s.stepDescription,
                    status: s.status,
                    error: s.error?.substring(0, 400),
                    failureAnalysis: s.failureAnalysis,
                }));
                executionReports.push({ goal, status: report.status, reportId: report._id, steps: stepSummary });

                // ── #22 Append key findings to KB for next goals ─────────────
                const failedSteps = stepSummary.filter((s: any) => s.status === "FAILED" && s.failureAnalysis);
                if (failedSteps.length > 0) {
                    kbLines.push(`\n## Goal: ${goal}`);
                    for (const s of failedSteps.slice(0, 3)) {
                        const fa = s.failureAnalysis;
                        kbLines.push(`- **${fa.documentationGap}** in \`${fa.failedFunction}\`: ${fa.reasoning.slice(0, 200)}`);
                        if (fa.suggestedDocsFix) kbLines.push(`  Fix: ${fa.suggestedDocsFix.slice(0, 150)}`);
                    }
                }

                onProgress?.(JSON.stringify({ type: "GOAL_COMPLETE", goal, status: report.status, reportId: report._id }));
            } else {
                executionReports.push({ goal, status: "FAILED", reportId: null, steps: [] });
                onProgress?.(JSON.stringify({ type: "GOAL_COMPLETE", goal, status: "FAILED", reportId: null }));
            }

            await this.testSuiteRepository.delete(testSuite._id as types.test.TestSuiteId);
        }

        // 4. Aggregate gaps
        const findings = collectFindings(executionReports);
        const clusters = clusterGaps(findings);

        // ── #19 Regression tracking ───────────────────────────────────────────
        // Compare current clusters against the most recent prior MASTER_PLAN run.
        const regressionMap = await this.computeRegressionStatus(projectId, clusters);

        onProgress?.(JSON.stringify({ type: "log", content: "Generating final master summary..." }));
        const { structured, markdown } = await this.promptService.promptForMasterSummary(
            executionReports,
            clusters,
        );

        // 5. Override LLM-derived figures with deterministic ones.
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
            reportId: r.reportId,
            keyFindings: llmFindingsByGoal.get(r.goal) ?? "",
        }));

        onProgress?.(JSON.stringify({ type: "SUMMARY_GENERATED", summary: markdown, structured }));

        // 6. Store Master Plan as a Report
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
        } as any);

        // 7. Back-link each partial report to this master plan report
        await Promise.all(
            reportIds.map(rid =>
                this.reportRepository.setMasterPlanId(rid, masterPlan._id as string)
            )
        );

        onProgress?.(JSON.stringify({ type: "log", content: "Master Plan execution completed." }));
        return masterPlan;
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
        // 1. Load original master plan
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

        onProgress?.(JSON.stringify({ type: "INIT", projectId, rerun: true, originalMasterPlanId }));

        // 2. Load project files for the (possibly different) project
        const project = await this.projectRepository.get(projectId);
        if (!project) throw new Error("Project not found");

        const files = await Promise.all(
            project.files.map((fileId) => this.fileService.downloadFile(fileId)),
        );
        const validFiles = files.filter((f): f is NonNullable<typeof f> => !!f);
        if (validFiles.length === 0) throw new Error("No documentation files found for this project.");

        // 3. Doc-examples smoke test (same as runMasterPlan)
        const docExamples = extractDocExamples(validFiles);
        const docExampleResults: { label: string; success: boolean; error?: unknown }[] = [];
        for (const ex of docExamples.slice(0, 10)) {
            const label = docExampleLabel(ex);
            try {
                const result = await this.executor.runDocExample(ex.code);
                docExampleResults.push({ label, success: result.success, error: result.error });
                onProgress?.(JSON.stringify({
                    type: "log",
                    content: `Doc example [${label}]: ${result.success ? "PASS" : "FAIL"}`,
                }));
            } catch {
                docExampleResults.push({ label, success: false, error: "Executor error" });
            }
        }

        onProgress?.(JSON.stringify({
            type: "GOALS_GENERATED",
            goals,
            note: `Reusing ${goals.length} goals from master plan ${originalMasterPlanId}`,
        }));

        // 4. Execute goals (identical loop to runMasterPlan)
        const kbLines: string[] = ["# Shared Knowledge Base (prior goal findings)\n"];
        const reportIds: types.report.ReportId[] = [];
        const executionReports: any[] = [];

        for (let i = 0; i < goals.length; i++) {
            const goal = goals[i];
            onProgress?.(JSON.stringify({ type: "GOAL_START", goal, index: i, total: goals.length }));

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
                (msg) => { onProgress?.(JSON.stringify({ type: "GOAL_PROGRESS", goal, log: msg })); },
            );

            if (report) {
                reportIds.push(report._id as types.report.ReportId);
                const stepSummary = report.steps.map((s: any) => ({
                    stepIndex: s.stepIndex,
                    description: s.stepDescription,
                    status: s.status,
                    error: s.error?.substring(0, 400),
                    failureAnalysis: s.failureAnalysis,
                }));
                executionReports.push({ goal, status: report.status, reportId: report._id, steps: stepSummary });

                const failedSteps = stepSummary.filter((s: any) => s.status === "FAILED" && s.failureAnalysis);
                if (failedSteps.length > 0) {
                    kbLines.push(`\n## Goal: ${goal}`);
                    for (const s of failedSteps.slice(0, 3)) {
                        const fa = s.failureAnalysis;
                        kbLines.push(`- **${fa.documentationGap}** in \`${fa.failedFunction}\`: ${fa.reasoning.slice(0, 200)}`);
                        if (fa.suggestedDocsFix) kbLines.push(`  Fix: ${fa.suggestedDocsFix.slice(0, 150)}`);
                    }
                }
                onProgress?.(JSON.stringify({ type: "GOAL_COMPLETE", goal, status: report.status, reportId: report._id }));
            } else {
                executionReports.push({ goal, status: "FAILED", reportId: null, steps: [] });
                onProgress?.(JSON.stringify({ type: "GOAL_COMPLETE", goal, status: "FAILED", reportId: null }));
            }

            await this.testSuiteRepository.delete(testSuite._id as types.test.TestSuiteId);
        }

        // 5. Aggregate + regression vs. ORIGINAL plan's gaps (not the most recent for the project)
        const findings = collectFindings(executionReports);
        const clusters = clusterGaps(findings);
        const originalGaps: types.planner.DocumentationGapDetail[] =
            (original as any).structuredSummary?.documentationGapDetails ?? [];
        const regressionMap = await this.computeRegressionStatus(projectId, clusters, originalGaps);

        onProgress?.(JSON.stringify({ type: "log", content: "Generating final master summary..." }));
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
            reportId: r.reportId,
            keyFindings: llmFindingsByGoal.get(r.goal) ?? "",
        }));

        onProgress?.(JSON.stringify({ type: "SUMMARY_GENERATED", summary: markdown, structured }));

        // 6. Save as new MASTER_PLAN with back-reference to original
        const masterPlan = await this.reportRepository.create({
            projectId,
            status: "SUCCESS",
            type: "MASTER_PLAN",
            initialContext,
            executionPlan: {
                docExampleResults: docExampleResults.length > 0 ? docExampleResults : undefined,
                rerunFromMasterPlanId: originalMasterPlanId,
            },
            steps: [],
            detailedResults: { finalOutput: markdown },
            masterPlanGoals: goals,
            masterPlanReports: reportIds,
            structuredSummary: structured,
        } as any);

        await Promise.all(
            reportIds.map((rid) =>
                this.reportRepository.setMasterPlanId(rid, masterPlan._id as string)
            ),
        );

        onProgress?.(JSON.stringify({ type: "log", content: "Master Plan re-run completed." }));
        return masterPlan;
    }

    /**
     * #19 — Compare current gap clusters against the most recent prior run.
     * Returns a map of clusterKey → regressionStatus.
     * Accepts an optional explicit `priorGaps` list (used in rerun flow to compare
     * against the source master plan rather than the most recent project run).
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
                // Fetch the most recent master-plan report for the project
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
        } catch {
            // Regression tracking is best-effort; don't fail the run.
        }
        return result;
    }

    /** Fuzzy match two gap descriptions to detect persistence across runs. */
    private gapsSimilar(
        cluster: GapCluster,
        prior: types.planner.DocumentationGapDetail,
    ): boolean {
        // Same file + overlapping lines
        if (cluster.file && prior.file && cluster.file === prior.file) {
            if (
                cluster.lineStart !== undefined && cluster.lineEnd !== undefined &&
                prior.lineStart !== undefined && prior.lineEnd !== undefined
            ) {
                const overlap = Math.min(cluster.lineEnd, prior.lineEnd) -
                    Math.max(cluster.lineStart, prior.lineStart);
                if (overlap >= 0) return true;
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

    /**
     * #20 — Build a concise endpoint/function inventory from project documentation.
     * Used to steer goal generation toward thorough coverage.
     */
    private extractEndpointInventory(
        files: { metadata: { filename: string }; buffer: Uint8Array }[],
    ): string | undefined {
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
                                if (["parameters", "summary", "description"].includes(method)) continue;
                                const d = def as Record<string, unknown>;
                                const summary = (d?.summary || d?.description || "") as string;
                                lines.push(`- ${method.toUpperCase()} ${apiPath}${summary ? ` — ${summary.slice(0, 80)}` : ""}`);
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
                    // Headings containing HTTP methods or path-like patterns
                    if (line.match(/^#{1,4}\s.*(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/i) ||
                        line.match(/^#{1,4}\s.*\/[a-z]/i)) {
                        lines.push(`- ${line.replace(/^#{1,4}\s+/, "").slice(0, 100)}`);
                    }
                }
            }
        }

        if (lines.length === 0) return undefined;
        // Cap to avoid blowing the system prompt
        return lines.slice(0, 100).join("\n");
    }
}
