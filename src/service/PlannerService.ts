import { ProjectRepository } from "./ProjectRepository.ts";
import { FileService } from "./FileService.ts";
import { PromptService } from "./PromptService.ts";
import { Executor } from "./Executor.ts";
import { MasterPlanRepository } from "./MasterPlanRepository.ts";
import { TestSuiteRepository } from "./TestSuiteRepository.ts";
import * as types from "../types/index.ts";

export class PlannerService {
    constructor(
        private projectRepository: ProjectRepository,
        private fileService: FileService,
        private promptService: PromptService,
        private executor: Executor,
        private testSuiteRepository: TestSuiteRepository,
        private masterPlanRepository: MasterPlanRepository,
    ) {}

    public async runMasterPlan(projectId: types.project.ProjectId, onProgress?: (msg: string) => void) {
        onProgress?.(JSON.stringify({ type: "log", content: `Starting Master Plan for project: ${projectId}` }));
        
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
        const goals = await this.promptService.promptForUserGoals(docsContent, (msg) => {
            onProgress?.(JSON.stringify({ type: "log", content: msg }));
        });

        onProgress?.(JSON.stringify({ type: "log", content: `Generated ${goals.length} user goals.` }));

        const reportIds: types.report.ReportId[] = [];
        const executionReports: any[] = [];

        // 3. Execute a TestSuite for each goal
        for (let i = 0; i < goals.length; i++) {
            const goal = goals[i];
            onProgress?.(JSON.stringify({ type: "log", content: `Executing Goal ${i + 1}/${goals.length}: ${goal}` }));
            
            // Create a temporary TestSuite
            const testSuite = await this.testSuiteRepository.create({
                projectId,
                initialContext: "{}",
                minimalStoryLength: 1,
                maximalStoryLength: 3,
                mode: "CODE_GENERATION",
                userGoal: goal,
            });

            // Execute it using Executor
            const report = await this.executor.executeTestSuite(testSuite._id as types.test.TestSuiteId, (msg) => {
                // Pass through progress but prefix it with goal info
                onProgress?.(msg);
            });

            if (report) {
                reportIds.push(report._id as types.report.ReportId);
                executionReports.push({
                    goal,
                    status: report.status,
                    steps: report.steps.map(s => ({
                        description: s.stepDescription,
                        status: s.status,
                        error: s.error,
                        failureAnalysis: s.failureAnalysis,
                    })),
                });
            }
            
            // Clean up temporary test suite
            await this.testSuiteRepository.delete(testSuite._id as types.test.TestSuiteId);
        }

        // 4. Generate final summary
        onProgress?.(JSON.stringify({ type: "log", content: "Generating final master summary..." }));
        const finalSummary = await this.promptService.promptForMasterSummary(executionReports, (msg) => {
             // Only log string progress if needed or handle it
        });

        // 5. Store MasterPlanReport
        const masterPlan = await this.masterPlanRepository.create({
            projectId,
            goals,
            reports: reportIds,
            finalSummary,
        });

        onProgress?.(JSON.stringify({ type: "log", content: "Master Plan execution completed." }));
        return masterPlan;
    }
}
