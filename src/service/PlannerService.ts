import { ProjectRepository } from "./ProjectRepository.ts";
import { FileService } from "./FileService.ts";
import { PromptService } from "./PromptService.ts";
import { Executor } from "./Executor.ts";
import { TestSuiteRepository } from "./TestSuiteRepository.ts";
import { ReportRepository } from "./ReportRepository.ts";
import * as types from "../types/index.ts";

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
        const docsContent = validFiles.map((f) => new TextDecoder().decode(f.buffer)).join("\n\n");

        if (!docsContent) {
            throw new Error("No documentation content found for this project.");
        }

        // 2. Generate user goals
        onProgress?.(JSON.stringify({ type: "log", content: "Analyzing documentation and generating user goals..." }));
        const goals = await this.promptService.promptForUserGoals(docsContent, maxGoals, (msg) => {
            onProgress?.(JSON.stringify({ type: "log", content: msg }));
        });

        onProgress?.(JSON.stringify({ type: "GOALS_GENERATED", goals }));

        const reportIds: types.report.ReportId[] = [];
        // Full execution data — all step details including failureAnalysis for rich summary
        const executionReports: any[] = [];

        // 3. Execute a TestSuite for each goal
        for (let i = 0; i < goals.length; i++) {
            const goal = goals[i];
            onProgress?.(JSON.stringify({ type: "GOAL_START", goal, index: i, total: goals.length }));
            
            // Create a temporary TestSuite
            const testSuite = await this.testSuiteRepository.create({
                projectId,
                initialContext: initialContext,
                minimalStoryLength: 1,
                maximalStoryLength: 3,
                mode: "CODE_GENERATION",
                userGoal: goal,
            });

            // Execute it using Executor
            const report = await this.executor.executeTestSuite(testSuite._id as types.test.TestSuiteId, (msg) => {
                onProgress?.(JSON.stringify({ type: "GOAL_PROGRESS", goal, log: msg }));
            });

            if (report) {
                reportIds.push(report._id as types.report.ReportId);
                // Pass FULL step data (including all failureAnalysis fields) to the summary LLM
                executionReports.push({
                    goal,
                    status: report.status,
                    reportId: report._id,
                    steps: report.steps.map(s => ({
                        stepIndex: s.stepIndex,
                        description: s.stepDescription,
                        status: s.status,
                        error: s.error,
                        failureAnalysis: s.failureAnalysis,
                    })),
                });
                onProgress?.(JSON.stringify({ type: "GOAL_COMPLETE", goal, status: report.status, reportId: report._id }));
            } else {
                executionReports.push({ goal, status: "FAILED", reportId: null, steps: [] });
                onProgress?.(JSON.stringify({ type: "GOAL_COMPLETE", goal, status: "FAILED", reportId: null }));
            }
            
            // Clean up temporary test suite
            await this.testSuiteRepository.delete(testSuite._id as types.test.TestSuiteId);
        }

        // 4. Generate structured summary from full report data
        onProgress?.(JSON.stringify({ type: "log", content: "Generating final master summary..." }));
        const { structured, markdown } = await this.promptService.promptForMasterSummary(executionReports);
        
        onProgress?.(JSON.stringify({ type: "SUMMARY_GENERATED", summary: markdown, structured }));

        // 5. Store Master Plan as a Report in the reports collection
        const masterPlan = await this.reportRepository.create({
            projectId,
            status: "SUCCESS",
            type: "MASTER_PLAN",
            initialContext,
            executionPlan: null,
            steps: [],
            detailedResults: { finalOutput: markdown },
            masterPlanGoals: goals,
            masterPlanReports: reportIds,
            structuredSummary: structured,
        } as any);

        // 6. Back-link each partial report to this master plan report
        await Promise.all(
            reportIds.map(rid =>
                this.reportRepository.setMasterPlanId(rid, masterPlan._id as string)
            )
        );

        onProgress?.(JSON.stringify({ type: "log", content: "Master Plan execution completed." }));
        return masterPlan;
    }
}
