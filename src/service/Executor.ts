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
        private reportRepository: ReportRepository,
    ) {
        this.dockerExecutor = new DockerExecutor({
            timeoutMs: 10000,
            memoryLimit: "256m",
            networkAccess: true,
            networkName: "rookie-network",
        });
    }

    async executeTestSuite(testSuiteId: types.test.TestSuiteId, onProgress?: (msg: string) => void) {
        onProgress?.(JSON.stringify({ type: "log", content: "Starting execution of Test Suite: " + testSuiteId }));
        const startTime = Date.now();
        const testSuite = await this.testSuiteRepository.get(testSuiteId);
        if (!testSuite) return null;

        const project = await this.projectRepository.get(testSuite.projectId);
        if (!project) return null;

        const files = await Promise.all(
            project.files.map((file) => this.fileService.downloadFile(file)),
        );
        const validFiles = files.filter((file): file is NonNullable<typeof file> => !!file);
        
        onProgress?.(JSON.stringify({ type: "log", content: `Downloaded ${validFiles.length} project context files.` }));

        if (testSuite.mode === "CODE_GENERATION") {
            return await this.executeCodeGeneration(testSuite, validFiles, startTime, onProgress);
        } else {
            return await this.executeTestScenario(testSuite, validFiles, startTime, onProgress);
        }
    }

    private async executeCodeGeneration(
        testSuite: types.test.TestSuite,
        _files: { buffer: Uint8Array }[],
        startTime: number,
        onProgress?: (msg: string) => void,
    ) {
        onProgress?.(JSON.stringify({ type: "log", content: "Starting Agentic RAG for CODE_GENERATION..." }));
        const codeGenResponse = await this.promptService.promptForCodeGenerationWithAgenticRAG(
            testSuite.projectId,
            testSuite.userGoal || "No goal specified",
            onProgress,
            async (code, env, deps) => {
                const execResult = await this.runStepInDocker(
                    code,
                    JSON.parse(testSuite.initialContext),
                    env,
                    deps,
                );
                
                if (execResult.success) {
                    return `SUCCESS.\nOutput: ${JSON.stringify(execResult.result)}`;
                } else {
                    return `FAILED.\nError: ${execResult.error}\nLogs: ${execResult.logs}`;
                }
            }
        );
        onProgress?.(JSON.stringify({ type: "log", content: "Code Generation completed. Executing in Docker environment..." }));

        const stepsResults: types.report.StepResult[] = [];
        let hasFailures = false;

        let i = 0;
        for (const example of codeGenResponse.examples) {
            i++;
            this.logger.log(`Executing generated example ${i}: ${example.title}`);
            onProgress?.(JSON.stringify({ type: "log", content: `Running Docker container for Example ${i}: ${example.title}...` }));
            const execResult = await this.runStepInDocker(
                example.fullProgram,
                JSON.parse(testSuite.initialContext),
                example.environment || "node",
                example.dependencies || [],
            );

            const stepReport: types.report.StepResult = {
                stepIndex: i,
                stepDescription: `${example.title}: ${example.explanation}`,
                scriptContent: example.fullProgram,
                status: execResult.success ? "SUCCESS" : "FAILED",
                logs: execResult.logs,
                contextAfter: execResult.result?.ctx || null,
            };

            if (!execResult.success) {
                hasFailures = true;
                stepReport.error = typeof execResult.error === "object"
                    ? JSON.stringify(execResult.error)
                    : String(execResult.error);

                stepReport.relatedKnowledge = await this.findRelatedKnowledge(
                    testSuite.projectId,
                    `Error in example ${example.title}: ${example.explanation}`,
                );
            }
            stepsResults.push(stepReport);
        }

        const reportData: Omit<types.report.Report, "id" | "createdAt"> = {
            testSuiteId: testSuite._id,
            projectId: testSuite.projectId,
            status: hasFailures ? "FAILED" : "SUCCESS",
            type: "CODE_GENERATION",
            initialContext: testSuite.initialContext,
            executionPlan: codeGenResponse,
            steps: stepsResults,
            durationMs: Date.now() - startTime,
            detailedResults: {
                executionPlan: codeGenResponse,
                initialContext: testSuite.initialContext,
                steps: stepsResults,
                durationMs: Date.now() - startTime,
                finalOutput: codeGenResponse.finalMarkdownSummary,
            },
        };

        return await this.reportRepository.create(reportData);
    }

    private async executeTestScenario(
        testSuite: types.test.TestSuite,
        files: { buffer: Uint8Array }[],
        startTime: number,
        onProgress?: (msg: string) => void,
    ) {
        const docs = files.map((f) => new TextDecoder().decode(f.buffer)).join("\n");
        onProgress?.(JSON.stringify({ type: "log", content: "Generating Test Scenario execution plan..." }));
        const plan = await this.promptService.promptForApiUsageScenario(
            docs,
            testSuite.initialContext,
            {
                minimalLength: testSuite.minimalStoryLength,
                maximalLength: testSuite.maximalStoryLength,
            },
            onProgress
        );
        onProgress?.(JSON.stringify({ type: "log", content: `Generated test plan with ${plan.calls.length} steps. Executing...` }));

        let context = JSON.parse(testSuite.initialContext);
        const stepsResults: types.report.StepResult[] = [];
        let hasFailures = false;

        let i = 0;
        for (const call of plan.calls) {
            i++;
            this.logger.log(`Executing step ${i}: ${call.stepExplanation}`);
            onProgress?.(JSON.stringify({ type: "log", content: `Running Docker container for Step ${i}: ${call.stepExplanation}...` }));
            const execResult = await this.runStepInDocker(call.fetch, context);

            const stepReport: types.report.StepResult = {
                stepIndex: i,
                stepDescription: call.stepExplanation,
                scriptContent: call.fetch,
                status: execResult.success ? "SUCCESS" : "FAILED",
                logs: execResult.logs,
                contextAfter: execResult.result?.ctx || null,
            };

            if (execResult.success && execResult.result) {
                context = execResult.result.ctx;
            } else {
                hasFailures = true;
                stepReport.error = typeof execResult.error === "object"
                    ? JSON.stringify(execResult.error)
                    : String(execResult.error);

                stepReport.relatedKnowledge = await this.findRelatedKnowledge(
                    testSuite.projectId,
                    call.stepExplanation,
                );
            }
            stepsResults.push(stepReport);
        }

        const reportData: Omit<types.report.Report, "id" | "createdAt"> = {
            testSuiteId: testSuite._id,
            projectId: testSuite.projectId,
            status: hasFailures ? "FAILED" : "SUCCESS",
            type: "TEST_SCENARIO",
            initialContext: testSuite.initialContext,
            executionPlan: plan,
            steps: stepsResults,
            durationMs: Date.now() - startTime,
            detailedResults: {
                executionPlan: plan,
                initialContext: testSuite.initialContext,
                steps: stepsResults,
                durationMs: Date.now() - startTime,
            },
        };

        return await this.reportRepository.create(reportData);
    }

    private async findRelatedKnowledge(projectId: string, query: string) {
        try {
            const vCollection = await this.vectorCollectionFactory.createCollection(projectId);
            const [dense, sparse] = await Promise.all([
                this.embeddingService.embed(query),
                this.embeddingService.sparseEmbed(query),
            ]);
            return await vCollection.searchHybrid(dense[0], sparse, 3);
        } catch (err) {
            this.logger.error(err, "Failed to perform hybrid search for related knowledge");
            return [];
        }
    }

    private extractCodeBlocks(markdown: string): string[] {
        const regex = /```javascript\n([\s\S]*?)\n```/g;
        const blocks = [];
        let match;
        while ((match = regex.exec(markdown)) !== null) {
            blocks.push(match[1]);
        }
        return blocks;
    }

    private async runStepInDocker(
        userCode: string,
        currentCtx: unknown,
        environment: "node" | "browser" = "node",
        dependencies: string[] = [],
    ): Promise<{
        success: boolean;
        result?: { ctx: unknown; result: unknown };
        error?: unknown;
        logs: string;
    }> {
        const cleanedUserCode = userCode.replace("export default", "const runStep =");

        const script = `
            const ctx = ${JSON.stringify(currentCtx)};

            ${cleanedUserCode}

            (async () => {
                try {
                    const runFunc = typeof runStep === 'function' ? runStep : (ctx) => { /* no-op if no default export */ };
                    const output = await runFunc(ctx);
                    console.log("___RESULT_START___");
                    console.log(JSON.stringify(output || { result: null, ctx }));
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
            const execResult = await this.dockerExecutor.execute(environment, script, dependencies);
            const fullLogs = `STDOUT:\n${execResult.stdout}\n\nSTDERR:\n${execResult.stderr}`;

            if (execResult.exitCode !== 0) {
                let parsedError = execResult.stderr;
                try {
                    parsedError = JSON.parse(execResult.stderr);
                } catch {
                    // Ignore JSON parse errors
                }
                return { success: false, error: parsedError, logs: fullLogs };
            }

            const stdout = execResult.stdout;
            const startMarker = "___RESULT_START___";
            const endMarker = "___RESULT_END___";
            const startIndex = stdout.indexOf(startMarker);
            const endIndex = stdout.indexOf(endMarker);

            if (startIndex === -1 || endIndex === -1) {
                return { success: true, result: { ctx: currentCtx, result: null }, logs: fullLogs };
            }

            const jsonStr = stdout.substring(startIndex + startMarker.length, endIndex).trim();
            const resultData = JSON.parse(jsonStr);
            return { success: true, result: resultData, logs: fullLogs };
        } catch (error) {
            const err = error as { message?: string };
            this.logger.error(error, "Docker execution system exception:");
            return {
                success: false,
                error: err?.message || "Unknown error",
                logs: `System Error: ${err?.message || "Unknown error"}`,
            };
        }
    }
}
