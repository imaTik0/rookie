import { VectorCollectionFactory } from "../db/vectordb/VectorCollectionFactory.ts";
import { Logger } from "../Logger.ts";
import * as types from "../types/index.ts";
import { EmbeddingService } from "./EmbeddingService.ts";
import { FileService } from "./FileService.ts";
import { ProjectRepository } from "./ProjectRepository.ts";
import { PromptService } from "./PromptService.ts";
import { TestSuiteRepository } from "./TestSuiteRepository.ts";
import { DockerExecutor } from "./DockerExecutor.ts";
import { ReportRepository } from "./ReportRepository.ts";

export class Executor {
    private dockerExecutor: DockerExecutor;

    constructor(
        private testSuiteRepository: TestSuiteRepository,
        private promptService: PromptService,
        private projectRepository: ProjectRepository,
        private fileService: FileService,
        private logger: Logger,
        private vectorCollectionFactory: VectorCollectionFactory,
        private embeddingService: EmbeddingService,
        private reportRepository: ReportRepository, // <--- Injected Repository
        // dockerConfig?: any
    ) {
        this.dockerExecutor = new DockerExecutor({
            timeoutMs: 10000,
            memoryLimit: "256m",
            networkAccess: true,
            networkName: "rookie-network",
        });
    }

    async executeTestSuite(testSuiteId: types.test.TestSuiteId) {
        const startTime = Date.now();
        const testSuite = await this.testSuiteRepository.get(testSuiteId);
        if (!testSuite) return null;

        const project = await this.projectRepository.get(testSuite.projectId);
        if (!project) return null;

        // 1. Prepare Files
        const files = await Promise.all(
            project.files.map((file) => this.fileService.downloadFile(file)),
        );

        // 2. Generate Plan
        const plan = await this.promptService.promptForApiUsageScenario(
            files.filter((file) => !!file).map((file) => file.buffer.toString()).join("\n"),
            testSuite.initialContext,
        );

        // Initialize Report Data
        let context = JSON.parse(testSuite.initialContext);
        const stepsResults: types.report.StepResult[] = [];
        let hasFailures = false;

        // 3. Execution Loop
        let i = 0;
        for (const call of plan.calls) {
            i++;
            this.logger.log(`Executing step ${i}: ${call.stepExplanation}`);

            // Run in Docker
            const execResult = await this.runStepInDocker(call.fetch, context);

            // Prepare Step Report
            const stepReport: types.report.StepResult = {
                stepIndex: i,
                stepDescription: call.stepExplanation,
                scriptContent: call.fetch,
                status: execResult.success ? "SUCCESS" : "FAILED",
                logs: execResult.logs, // Full execution logs
                contextAfter: execResult.result?.ctx || null,
            };

            if (execResult.success && execResult.result) {
                // Update Context
                context = execResult.result.ctx;
            } else {
                hasFailures = true;
                stepReport.error = typeof execResult.error === "object"
                    ? JSON.stringify(execResult.error)
                    : String(execResult.error);

                // --- Vector Search for Failure Analysis ---
                try {
                    const vCollection = await this.vectorCollectionFactory.createCollection(
                        testSuite.projectId,
                    );
                    const embededFail = await this.embeddingService.embed(call.stepExplanation);
                    const related = await vCollection.search(embededFail[0], 3);
                    stepReport.relatedKnowledge = [related];
                } catch (err) {
                    this.logger.error(err, "Failed to perform vector search for failed step");
                }
            }

            stepsResults.push(stepReport);
        }

        // 4. Create and Save Report
        const reportData: Omit<types.report.Report, "id" | "createdAt"> = {
            testSuiteId: testSuiteId,
            projectId: testSuite.projectId,
            status: hasFailures ? "FAILED" : "SUCCESS",
            initialContext: testSuite.initialContext,
            executionPlan: plan, // Storing the full plan prompt result
            steps: stepsResults,
            durationMs: Date.now() - startTime,
        };

        const savedReport = await this.reportRepository.create(reportData);
        this.logger.log(`Report saved with ID: ${savedReport._id}`);

        return savedReport;
    }

    private async runStepInDocker(
        userCode: string,
        currentCtx: unknown,
    ): Promise<{
        success: boolean;
        result?: { ctx: unknown; result: unknown };
        error?: unknown;
        logs: string; // <-- Added logs to return type
    }> {
        const cleanedUserCode = userCode.replace("export default", "const runStep =");

        const script = `
            const ctx = ${JSON.stringify(currentCtx)};
            const { inspect } = require('util');

            ${cleanedUserCode}

            (async () => {
                try {
                    const output = await runStep(ctx);
                    console.log("___RESULT_START___");
                    console.log(JSON.stringify(output));
                    console.log("___RESULT_END___");
                } catch (e) {
                    let serializableError = {};
                    if (e instanceof Error) {
                        serializableError = {
                            message: e.message,
                            name: e.name,
                            stack: e.stack,
                            cause: e.cause
                        };
                        Object.assign(serializableError, e);
                        if (e.message === '[object Object]') {
                            serializableError.debug_inspect = inspect(e, { depth: 3, colors: false });
                        }
                    } else if (typeof e === 'object' && e !== null) {
                        serializableError = e;
                    } else {
                        serializableError = { message: String(e) };
                    }
                    console.error(JSON.stringify(serializableError));
                    process.exit(1);
                }
            })();
        `;

        try {
            const execResult = await this.dockerExecutor.execute("node", script);

            // Combine stdout and stderr for the log report
            const fullLogs = `STDOUT:\n${execResult.stdout}\n\nSTDERR:\n${execResult.stderr}`;

            if (execResult.exitCode !== 0) {
                let parsedError = execResult.stderr;
                try {
                    parsedError = JSON.parse(execResult.stderr);
                } catch {}

                return {
                    success: false,
                    error: parsedError,
                    logs: fullLogs,
                };
            }

            const stdout = execResult.stdout;
            const startMarker = "___RESULT_START___";
            const endMarker = "___RESULT_END___";

            const startIndex = stdout.indexOf(startMarker);
            const endIndex = stdout.indexOf(endMarker);

            if (startIndex === -1 || endIndex === -1) {
                return {
                    success: false,
                    error: "Script executed but returned no result structure.",
                    logs: fullLogs,
                };
            }

            const jsonStr = stdout.substring(startIndex + startMarker.length, endIndex).trim();
            const resultData = JSON.parse(jsonStr);

            return {
                success: true,
                result: resultData,
                logs: fullLogs,
            };
        } catch (error: any) {
            this.logger.error(error, "Docker execution system exception:");
            return {
                success: false,
                error: error.message,
                logs: `System Error: ${error.message}`,
            };
        }
    }
}
