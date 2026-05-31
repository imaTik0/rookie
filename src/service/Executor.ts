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
import { ConfigService } from "./ConfigService.ts";
import { isEnvironmentError, parseImportedPackages } from "../sandbox/depDetect.ts";

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
        private configService: ConfigService,
    ) {
        const sb = this.configService.values.sandbox;
        // networkMode: "none" → offline; "network"/named → attach to that docker network.
        const offline = sb.networkMode === "none";
        this.dockerExecutor = new DockerExecutor({
            timeoutMs: 60000,
            memoryLimit: "2048m",
            networkAccess: !offline,
            networkName: offline
                ? undefined
                : (sb.networkMode === "network" ? sb.networkName : sb.networkMode),
            hardening: sb.hardening,
            user: sb.user,
            pidsLimit: sb.pidsLimit,
        });
    }

    async executeTestSuite(
        testSuiteId: types.test.TestSuiteId,
        onProgress?: (msg: string) => void,
    ) {
        onProgress?.(
            JSON.stringify({
                type: "log",
                content: "Starting execution of Test Suite: " + testSuiteId,
            }),
        );
        const startTime = Date.now();
        const testSuite = await this.testSuiteRepository.get(testSuiteId);
        if (!testSuite) return null;

        const project = await this.projectRepository.get(testSuite.projectId);
        if (!project) return null;

        const files = await Promise.all(
            project.files.map((file) => this.fileService.downloadFile(file)),
        );
        const validFiles = files.filter((file): file is NonNullable<typeof file> => !!file);

        onProgress?.(
            JSON.stringify({
                type: "log",
                content: `Downloaded ${validFiles.length} project context files.`,
            }),
        );

        if (testSuite.mode === "CODE_GENERATION") {
            return await this.executeCodeGeneration(testSuite as unknown as types.test.TestSuite, validFiles, startTime, onProgress);
        } else {
            return await this.executeTestScenario(testSuite as unknown as types.test.TestSuite, validFiles, startTime, onProgress);
        }
    }

    private async executeCodeGeneration(
        testSuite: types.test.TestSuite,
        _files: { metadata: any, buffer: Uint8Array }[],
        startTime: number,
        onProgress?: (msg: string) => void,
    ) {
        onProgress?.(
            JSON.stringify({ type: "log", content: "Starting Agentic RAG for CODE_GENERATION..." }),
        );
        const { response: codeGenResponse, history: conversationHistory } = await this.promptService.promptForCodeGenerationWithAgenticRAG(
            testSuite.projectId,
            testSuite.userGoal || "No goal specified",
            onProgress,
            async (code) => {
                const execResult = await this.runStepInDocker(
                    code,
                    JSON.parse(testSuite.initialContext)
                );

                if (execResult.success) {
                    return `SUCCESS.\nOutput: ${JSON.stringify(execResult.result)}`;
                } else {
                    return `FAILED.\nError: ${execResult.error}\nLogs: ${execResult.logs}`;
                }
            },
        );
        onProgress?.(
            JSON.stringify({
                type: "log",
                content: "Code Generation completed. Executing in Docker environment...",
            }),
        );

        const stepsResults: types.report.StepResult[] = [];
        let hasFailures = false;

        let i = 0;
        for (const example of codeGenResponse.examples) {
            i++;
            this.logger.log(`Executing generated example ${i}: ${example.title}`);
            onProgress?.(
                JSON.stringify({
                    type: "log",
                    content: `Running Docker container for Example ${i}: ${example.title}...`,
                }),
            );
            const execResult = await this.runStepInDocker(
                example.fullProgram,
                JSON.parse(testSuite.initialContext)
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

                await this.analyzeStepFailure(
                    testSuite.projectId,
                    stepReport,
                    example.fullProgram,
                    `${example.title}: ${example.explanation}`,
                    example.explanation || example.title,
                    onProgress,
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
            conversationHistory: conversationHistory,
            durationMs: Date.now() - startTime,
            detailedResults: {
                executionPlan: codeGenResponse,
                initialContext: testSuite.initialContext,
                steps: stepsResults,
                conversationHistory: conversationHistory,
                durationMs: Date.now() - startTime,
                finalOutput: codeGenResponse.finalMarkdownSummary,
            },
        };

        return await this.reportRepository.create(reportData);
    }

    private async executeTestScenario(
        testSuite: types.test.TestSuite,
        files: { metadata: any, buffer: Uint8Array }[],
        startTime: number,
        onProgress?: (msg: string) => void,
    ) {
        onProgress?.(
            JSON.stringify({ type: "log", content: "Generating Test Scenario execution plan..." }),
        );
        const plan = await this.promptService.promptForApiUsageScenario(
            testSuite.projectId as string,
            files,
            testSuite.initialContext,
            {
                minimalLength: testSuite.minimalStoryLength,
                maximalLength: testSuite.maximalStoryLength,
            },
            onProgress,
        );
        onProgress?.(
            JSON.stringify({
                type: "log",
                content: `Generated test plan with ${plan.calls.length} steps. Executing...`,
            }),
        );

        let context = JSON.parse(testSuite.initialContext);
        const stepsResults: types.report.StepResult[] = [];
        let hasFailures = false;

        let i = 0;
        for (const call of plan.calls) {
            i++;
            this.logger.log(`Executing step ${i}: ${call.stepExplanation}`);
            onProgress?.(
                JSON.stringify({
                    type: "log",
                    content: `Running Docker container for Step ${i}: ${call.stepExplanation}...`,
                }),
            );
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

                await this.analyzeStepFailure(
                    testSuite.projectId,
                    stepReport,
                    call.fetch,
                    call.stepExplanation,
                    call.stepExplanation,
                    onProgress,
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

    /**
     * Diagnose a failed step. Environment/tooling failures (missing dependency,
     * sandbox limit, etc.) are classified directly as ENVIRONMENT so the
     * documentation isn't wrongly blamed. Genuine failures go to the LLM
     * documentation-gap classifier with RAG-retrieved related docs.
     */
    private async analyzeStepFailure(
        projectId: string,
        stepReport: types.report.StepResult,
        code: string,
        description: string,
        queryContext: string,
        onProgress?: (msg: string) => void,
    ): Promise<void> {
        const error = stepReport.error || "Unknown error";

        if (isEnvironmentError(error)) {
            stepReport.failureAnalysis = {
                errorMessage: error.substring(0, 200),
                failedFunction: "n/a (environment)",
                documentationGap: "ENVIRONMENT",
                reasoning:
                    "Failure was caused by the execution environment/tooling (e.g. a missing dependency, failed install, or sandbox limit), not by the documentation.",
                suggestedDocsFix:
                    "No documentation change required. Verify the runtime, dependencies and sandbox configuration.",
            };
            onProgress?.(
                JSON.stringify({
                    type: "log",
                    content: `Failure classified as: ENVIRONMENT - ${stepReport.failureAnalysis.reasoning}`,
                }),
            );
            return;
        }

        const refinedQuery = await this.promptService.refineSearchQuery(error, queryContext);
        stepReport.relatedKnowledge = await this.findRelatedKnowledge(projectId, refinedQuery);

        const relatedDocsText = (stepReport.relatedKnowledge || [])
            .map((k: any) => {
                const payload = k.payload || {};
                const fileName = payload.metadata?.fileName || "unknown_file";
                const line = payload.metadata?.lineNumber
                    ? ` [Line: ${payload.metadata.lineNumber}]`
                    : "";
                return `--- DOCUMENT: ${fileName}${line} ---\n${payload.content || JSON.stringify(k)}`;
            })
            .join("\n\n").substring(0, 15000);

        stepReport.failureAnalysis = await this.promptService.classifyFailure(
            error,
            code,
            relatedDocsText,
            description,
        );
        onProgress?.(
            JSON.stringify({
                type: "log",
                content:
                    `Failure classified as: ${stepReport.failureAnalysis.documentationGap} - ${stepReport.failureAnalysis.reasoning}`,
            }),
        );
    }

    private async findRelatedKnowledge(projectId: string, query: string) {
        try {
            const vCollection = await this.vectorCollectionFactory.createCollection<
                types.file.FileShard
            >(projectId);
            const limit = this.configService.values.limits.relatedDocsLimit;
            const rerankCfg = this.configService.values.reranker;
            const fetchLimit = rerankCfg.mode === "off" ? limit : Math.max(limit, rerankCfg.topN);

            const [dense, sparse] = await Promise.all([
                this.embeddingService.embed(query),
                Promise.resolve(this.embeddingService.sparseEmbed(query)),
            ]);
            const raw = await vCollection.searchHybrid(dense[0], sparse, fetchLimit);
            return await this.promptService.rerankSearchResults(query, raw, limit);
        } catch (err) {
            this.logger.error(err, "Failed to perform hybrid search for related knowledge");
            return [];
        }
    }

    private async runStepInDocker(
        userCode: string,
        currentCtx: unknown,
    ): Promise<{
        success: boolean;
        result?: { ctx: unknown; result: unknown };
        error?: unknown;
        logs: string;
    }> {
        // Install any third-party packages the generated code imports, so library
        // examples actually run instead of failing with MODULE_NOT_FOUND.
        const packages = this.configService.values.sandbox.autoInstallDeps
            ? parseImportedPackages(userCode)
            : [];
        if (packages.length > 0) {
            this.logger.log(`Sandbox installing packages: ${packages.join(", ")}`);
        }

        const script = `
                import fs from 'fs';
                const ctx = ${JSON.stringify(currentCtx)};
                const userCode = ${JSON.stringify(userCode)};
                
                fs.writeFileSync('./userStep.js', userCode);

                ; (async () => {
                    try {
                        const userModule = await import('./userStep.js');
                        const runFunc = typeof userModule.default === 'function' ? userModule.default : (ctx) => { /* no-op */ };
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
            const execResult = await this.dockerExecutor.execute(
                "node",
                script,
                { timeoutMs: 60000, packages },
            );
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
