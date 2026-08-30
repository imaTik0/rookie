import { Injectable } from "../ioc/decorator.ts";
import { VectorCollectionFactory } from "../db/vectordb/VectorCollectionFactory.ts";
import { Logger } from "../Logger.ts";
import * as types from "../types/index.ts";
import type { DocFile } from "../types/file.ts";
import { EmbeddingService } from "./EmbeddingService.ts";
import { FileService } from "./FileService.ts";
import { ProjectRepository } from "../db/mongo/ProjectRepository.ts";
import { PromptService } from "./PromptService.ts";
import { TestSuiteRepository } from "../db/mongo/TestSuiteRepository.ts";
import { DockerExecutor } from "./DockerExecutor.ts";
import { ReportRepository } from "../db/mongo/ReportRepository.ts";
import { ConfigService } from "./ConfigService.ts";
import {
    applyPackageOverrides,
    isEnvironmentError,
    parseImportedPackages,
} from "../sandbox/depDetect.ts";
import {
    buildSandboxHarness,
    HTTP_LOG_END,
    HTTP_LOG_START,
    RESULT_END,
    RESULT_START,
} from "../sandbox/harness.ts";
import { extractApiHosts, isGrounded, ungroundedSuccessError } from "../sandbox/grounding.ts";
import { checkFaithfulness } from "../sandbox/faithfulness.ts";
import type { CodeGenerationResponse } from "./PromptService.ts";
import { JobCancelledError } from "../types/job.ts";
import {
    CorpusFile,
    corpusFromFiles,
    corpusMentions,
    extractMissingModule,
    verifyFragment,
} from "../feedback/fragmentVerify.ts";

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new JobCancelledError();
}

@Injectable()
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
        const offline = sb.networkMode === "none";
        this.dockerExecutor = new DockerExecutor({
            timeoutMs: sb.stepTimeoutMs,
            installTimeoutMs: sb.installTimeoutMs,
            maxConcurrent: sb.maxConcurrentContainers,
            memoryLimit: sb.memoryLimit,
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
        signal?: AbortSignal,
    ) {
        throwIfAborted(signal);
        onProgress?.(
            JSON.stringify({
                type: "log",
                content: "Starting execution of Test Suite: " + testSuiteId,
            }),
        );
        const startTime = Date.now();
        const testSuite = await this.testSuiteRepository.get(testSuiteId);
        if (!testSuite) {
            this.logger.error(new Error("Not found"), `TestSuite ${testSuiteId} not found`);
            onProgress?.(
                JSON.stringify({ type: "log", content: `TestSuite ${testSuiteId} not found` }),
            );
            return null;
        }

        const project = await this.projectRepository.get(testSuite.projectId);
        if (!project) {
            this.logger.error(
                new Error("Not found"),
                `Project ${testSuite.projectId} not found (referenced by TestSuite ${testSuiteId})`,
            );
            onProgress?.(
                JSON.stringify({
                    type: "log",
                    content: `Project ${testSuite.projectId} not found`,
                }),
            );
            return null;
        }

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
            return await this.executeCodeGeneration(
                testSuite as unknown as types.test.TestSuite,
                validFiles,
                startTime,
                onProgress,
                signal,
            );
        } else {
            return await this.executeTestScenario(
                testSuite as unknown as types.test.TestSuite,
                validFiles,
                startTime,
                onProgress,
                signal,
            );
        }
    }

    private async executeCodeGeneration(
        testSuite: types.test.TestSuite,
        files: DocFile[],
        startTime: number,
        onProgress?: (msg: string) => void,
        signal?: AbortSignal,
    ) {
        let codeGenResponse: CodeGenerationResponse;
        let conversationHistory: unknown[] = [];
        let usedDocsContext: string | undefined;
        let coverageReport: types.report.CoverageItem[] | undefined;
        let frictionEvents: types.report.FrictionEvent[] = [];

        if (testSuite.frozenPrograms && testSuite.frozenPrograms.length > 0) {
            onProgress?.(JSON.stringify({
                type: "log",
                content:
                    `Frozen re-execution: running ${testSuite.frozenPrograms.length} baseline ` +
                    `program(s) verbatim (no regeneration).`,
            }));
            codeGenResponse = {
                examples: testSuite.frozenPrograms.map((p, i) => ({
                    title: `Frozen program ${i + 1}`,
                    explanation: "Re-executed baseline program (frozen; no regeneration).",
                    fullProgram: p,
                })),
                finalMarkdownSummary: "Frozen re-execution of baseline programs.",
            } as CodeGenerationResponse;
        } else {
            onProgress?.(JSON.stringify({
                type: "log",
                content: testSuite.withoutDocs
                    ? "Starting CODE_GENERATION WITHOUT documentation (parametric-knowledge ablation)..."
                    : "Starting Agentic RAG for CODE_GENERATION...",
            }));
            const gen = await this.promptService.promptForCodeGenerationWithAgenticRAG(
                testSuite.projectId,
                testSuite.userGoal || "No goal specified",
                files,
                onProgress,
                async (code) => {
                    const execResult = await this.runStepInDocker(
                        code,
                        this.parseInitialContext(testSuite.initialContext),
                        { packageOverrides: testSuite.packageOverrides },
                    );
                    return execResult.success
                        ? `SUCCESS.\nOutput: ${JSON.stringify(execResult.result)}`
                        : `FAILED.\nError: ${execResult.error}\nLogs: ${execResult.logs}`;
                },
                testSuite.initialContext,
                testSuite.withoutDocs,
            );
            codeGenResponse = gen.response;
            conversationHistory = gen.history;
            usedDocsContext = gen.contextFound;
            coverageReport = gen.coverageReport;
            frictionEvents = gen.frictionEvents;
            onProgress?.(JSON.stringify({
                type: "log",
                content: "Code Generation completed. Executing in Docker environment...",
            }));
        }

        const corpus = corpusFromFiles(files);
        const ctx = this.parseInitialContext(testSuite.initialContext);

        throwIfAborted(signal);
        onProgress?.(JSON.stringify({
            type: "log",
            content: `Running ${codeGenResponse.examples.length} Docker containers in parallel…`,
        }));

        const execResults = await Promise.all(
            codeGenResponse.examples.map((example, idx) => {
                this.logger.log(`Executing generated example ${idx + 1}: ${example.title}`);
                return this.runStepInDocker(example.fullProgram, ctx, {
                    packageOverrides: testSuite.packageOverrides,
                });
            }),
        );

        const stepsResults: types.report.StepResult[] = execResults.map((execResult, idx) => {
            const example = codeGenResponse.examples[idx];
            const stepReport: types.report.StepResult = {
                stepIndex: idx + 1,
                stepDescription: `${example.title}: ${example.explanation}`,
                scriptContent: example.fullProgram,
                status: execResult.success ? "SUCCESS" : "FAILED",
                logs: execResult.logs,
                contextAfter: execResult.result?.ctx || null,
                httpTrafficLog: execResult.httpTrafficLog,
            };
            const faith = checkFaithfulness(example.fullProgram, testSuite.expectedApis ?? []);
            if (faith.checked) {
                stepReport.docsFaithful = faith.faithful;
                if (!faith.faithful) stepReport.docsUnfaithfulMissing = faith.missing;
            }
            if (!execResult.success) {
                stepReport.error = typeof execResult.error === "object"
                    ? JSON.stringify(execResult.error)
                    : String(execResult.error);
            }
            return stepReport;
        });

        throwIfAborted(signal);
        await Promise.all(
            stepsResults
                .filter((s) => s.status === "FAILED")
                .map((stepReport) => {
                    const idx = stepReport.stepIndex - 1;
                    const example = codeGenResponse.examples[idx];
                    return this.analyzeStepFailure(
                        testSuite.projectId,
                        stepReport,
                        example.fullProgram,
                        `${example.title}: ${example.explanation}`,
                        example.explanation || example.title,
                        corpus,
                        usedDocsContext,
                        onProgress,
                    );
                }),
        );

        const reportData: Omit<types.report.Report, "id" | "createdAt"> = {
            testSuiteId: testSuite._id,
            projectId: testSuite.projectId,
            status: this.overallStatus(stepsResults),
            type: "CODE_GENERATION",
            initialContext: testSuite.initialContext,
            executionPlan: codeGenResponse,
            steps: stepsResults,
            conversationHistory: conversationHistory,
            durationMs: Date.now() - startTime,
            coverageReport,
            frictionEvents: frictionEvents.length > 0 ? frictionEvents : undefined,
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

    private overallStatus(steps: types.report.StepResult[]): types.report.ReportStatus {
        const failed = steps.filter((s) => s.status === "FAILED").length;
        if (failed === 0) return "SUCCESS";
        if (failed === steps.length) return "FAILED";
        return "PARTIAL_FAILURE";
    }

    private async executeTestScenario(
        testSuite: types.test.TestSuite,
        files: DocFile[],
        startTime: number,
        onProgress?: (msg: string) => void,
        signal?: AbortSignal,
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

        let context = this.parseInitialContext(testSuite.initialContext);
        const corpus = corpusFromFiles(files);
        const stepsResults: types.report.StepResult[] = [];

        let i = 0;
        for (const call of plan.calls) {
            throwIfAborted(signal);
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
                httpTrafficLog: execResult.httpTrafficLog,
            };

            if (execResult.success && execResult.result) {
                if (execResult.result.ctx != null) {
                    context = execResult.result.ctx;
                }
            } else {
                stepReport.error = typeof execResult.error === "object"
                    ? JSON.stringify(execResult.error)
                    : String(execResult.error);

                await this.analyzeStepFailure(
                    testSuite.projectId,
                    stepReport,
                    call.fetch,
                    call.stepExplanation,
                    call.stepExplanation,
                    corpus,
                    undefined,
                    onProgress,
                );
            }
            stepsResults.push(stepReport);
        }

        const reportData: Omit<types.report.Report, "id" | "createdAt"> = {
            testSuiteId: testSuite._id,
            projectId: testSuite.projectId,
            status: this.overallStatus(stepsResults),
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

    private async analyzeStepFailure(
        projectId: string,
        stepReport: types.report.StepResult,
        code: string,
        description: string,
        queryContext: string,
        corpus: CorpusFile[],
        usedDocsContext?: string,
        onProgress?: (msg: string) => void,
    ): Promise<void> {
        const error = stepReport.error || "Unknown error";

        if (isEnvironmentError(error)) {
            stepReport.failureAnalysis = this.classifyEnvironmentError(error, corpus);
            onProgress?.(
                JSON.stringify({
                    type: "log",
                    content:
                        `Failure classified as: ${stepReport.failureAnalysis.documentationGap} - ${stepReport.failureAnalysis.reasoning}`,
                }),
            );
            return;
        }

        const refinedQuery = await this.promptService.refineSearchQuery(error, queryContext);
        stepReport.relatedKnowledge = await this.findRelatedKnowledge(projectId, refinedQuery);

        let relatedDocsText = (stepReport.relatedKnowledge || [])
            .map((k: any) => {
                const payload = k.payload || {};
                const fileName = payload.metadata?.fileName || "unknown_file";
                const line = payload.metadata?.lineNumber
                    ? ` [Line: ${payload.metadata.lineNumber}]`
                    : "";
                return `--- DOCUMENT: ${fileName}${line} ---\n${
                    payload.content || JSON.stringify(k)
                }`;
            })
            .join("\n\n").substring(0, 15000);

        if (usedDocsContext) {
            relatedDocsText +=
                `\n\n--- DOCUMENTATION CONTEXT USED DURING GENERATION (truncated) ---\n` +
                usedDocsContext.substring(0, 10000);
        }

        const analysis = await this.promptService.classifyFailure(
            error,
            code,
            relatedDocsText,
            description,
            { fragmentScorer: (fragment) => verifyFragment(fragment, corpus).matchScore },
            stepReport.httpTrafficLog,
        );

        analysis.fragmentVerification = verifyFragment(analysis.pinpointedFragment, corpus);
        stepReport.failureAnalysis = analysis;

        onProgress?.(
            JSON.stringify({
                type: "log",
                content: `Failure classified as: ${analysis.documentationGap} ` +
                    `(confidence ${analysis.confidence ?? "n/a"}, fragment ${
                        analysis.fragmentVerification.verified
                            ? `verified in ${analysis.fragmentVerification.file}`
                            : "NOT verified"
                    }) - ${analysis.reasoning}`,
            }),
        );
    }

    private classifyEnvironmentError(
        error: string,
        corpus: CorpusFile[],
    ): types.report.FailureAnalysis {
        const missingModule = extractMissingModule(error);

        if (missingModule && corpusMentions(corpus, missingModule)) {
            const installKeywords = [
                "npm install",
                "yarn add",
                "pip install",
                "install ",
                "import ",
                "require(",
            ];
            let hasInstallContext = false;
            let verification: types.report.FragmentVerification = {
                verified: false,
                matchScore: 0,
            };

            for (const file of corpus) {
                const lines = file.content.split("\n");
                const idx = lines.findIndex((l) =>
                    l.toLowerCase().includes(missingModule.toLowerCase())
                );
                if (idx !== -1) {
                    verification = {
                        verified: true,
                        file: file.filename,
                        lineStart: idx + 1,
                        lineEnd: idx + 1,
                        matchScore: 1,
                        matchedText: lines[idx],
                    };
                    const window = lines.slice(
                        Math.max(0, idx - 5),
                        Math.min(lines.length, idx + 6),
                    );
                    hasInstallContext = installKeywords.some((kw) =>
                        window.some((l) => l.toLowerCase().includes(kw))
                    );
                    break;
                }
            }

            const docsMissingInstall = !hasInstallContext;
            return {
                errorMessage: error.substring(0, 200),
                failedFunction: `import("${missingModule}")`,
                documentationGap: "CONFIG",
                reasoning: docsMissingInstall
                    ? `The documentation references "${missingModule}" but provides no install instructions. ` +
                        `A reader following the docs would hit this exact error.`
                    : `The documentation references "${missingModule}" but the package could not be ` +
                        `resolved at runtime, suggesting the install instructions are incomplete or incorrect.`,
                suggestedDocsFix: `Add explicit installation instructions for "${missingModule}" ` +
                    `(exact package name and install command, e.g. \`npm install ${missingModule}\`) ` +
                    `near its first usage in the docs.`,
                confidence: 1,
                votes: 0,
                fragmentVerification: verification,
            };
        }

        if (error.includes("ROOKIE_SANDBOX_TIMEOUT") || error.includes("Execution timed out")) {
            return {
                errorMessage: error.substring(0, 200),
                failedFunction: "n/a (sandbox timeout)",
                documentationGap: "ENVIRONMENT",
                reasoning:
                    "The sandbox exceeded its time budget. This reflects machine/infrastructure " +
                    "load (dependency install, container contention), not a documentation defect, " +
                    "and is excluded from documentation-gap analysis.",
                suggestedDocsFix:
                    "No documentation change required. Re-run with lower concurrency or a longer " +
                    "sandbox budget (ROOKIE_SANDBOX_STEP_TIMEOUT_MS).",
                confidence: 1,
                votes: 0,
            };
        }

        return {
            errorMessage: error.substring(0, 200),
            failedFunction: "n/a (environment)",
            documentationGap: "ENVIRONMENT",
            reasoning:
                "Failure was caused by the execution environment/tooling (e.g. a missing dependency, failed install, or sandbox limit), not by the documentation.",
            suggestedDocsFix:
                "No documentation change required. Verify the runtime, dependencies and sandbox configuration.",
            confidence: 1,
            votes: 0,
        };
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

    private parseInitialContext(raw: string): unknown {
        try {
            return JSON.parse(raw);
        } catch {
            this.logger.error(
                new Error("Invalid JSON"),
                `initialContext is not valid JSON: "${raw.slice(0, 120)}" — using empty context`,
            );
            return {};
        }
    }

    private async runStepInDocker(
        userCode: string,
        currentCtx: unknown,
        opts: { requireDefaultExport?: boolean; packageOverrides?: Record<string, string> } = {},
    ): Promise<{
        success: boolean;
        result?: { ctx: unknown; result: unknown };
        error?: unknown;
        logs: string;
        httpTrafficLog?: types.report.HttpTrafficEntry[];
    }> {
        const parsed = this.configService.values.sandbox.autoInstallDeps
            ? parseImportedPackages(userCode)
            : [];
        const packages = applyPackageOverrides(parsed, opts.packageOverrides);
        if (packages.length > 0) {
            this.logger.log(`Sandbox installing packages: ${packages.join(", ")}`);
        }

        const script = buildSandboxHarness(userCode, currentCtx, {
            requireDefaultExport: opts.requireDefaultExport,
        });

        try {
            const execResult = await this.dockerExecutor.execute(
                "node",
                script,
                { timeoutMs: this.configService.values.sandbox.stepTimeoutMs, packages },
            );
            const fullLogs = `STDOUT:\n${execResult.stdout}\n\nSTDERR:\n${execResult.stderr}`;
            const httpTrafficLog = this.parseHttpLog(execResult.stdout);

            if (execResult.exitCode !== 0) {
                let parsedError = execResult.stderr;
                try {
                    parsedError = JSON.parse(execResult.stderr);
                } catch {
                    // Ignore JSON parse errors
                }
                return { success: false, error: parsedError, logs: fullLogs, httpTrafficLog };
            }

            if (this.configService.values.sandbox.requireGroundedSuccess) {
                const declaredHosts = extractApiHosts(currentCtx);
                if (!isGrounded(declaredHosts, httpTrafficLog)) {
                    return {
                        success: false,
                        error: ungroundedSuccessError(declaredHosts),
                        logs: fullLogs,
                        httpTrafficLog,
                    };
                }
            }

            const stdout = execResult.stdout;
            const startMarker = RESULT_START;
            const endMarker = RESULT_END;
            const startIndex = stdout.indexOf(startMarker);
            const endIndex = stdout.indexOf(endMarker);

            if (startIndex === -1 || endIndex === -1) {
                return {
                    success: true,
                    result: { ctx: currentCtx, result: null },
                    logs: fullLogs,
                    httpTrafficLog,
                };
            }

            const jsonStr = stdout.substring(startIndex + startMarker.length, endIndex).trim();
            const resultData = JSON.parse(jsonStr);
            return { success: true, result: resultData, logs: fullLogs, httpTrafficLog };
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

    private parseHttpLog(stdout: string): types.report.HttpTrafficEntry[] | undefined {
        const start = stdout.indexOf(HTTP_LOG_START);
        const end = stdout.indexOf(HTTP_LOG_END);
        if (start === -1 || end === -1) return undefined;
        try {
            const json = stdout.substring(start + HTTP_LOG_START.length, end).trim();
            return JSON.parse(json) as types.report.HttpTrafficEntry[];
        } catch {
            return undefined;
        }
    }

    public async runDocExample(
        code: string,
        packageOverrides?: Record<string, string>,
    ): Promise<{
        success: boolean;
        logs: string;
        error?: unknown;
        httpTrafficLog?: types.report.HttpTrafficEntry[];
    }> {
        const result = await this.runStepInDocker(code, {}, {
            requireDefaultExport: false,
            packageOverrides,
        });
        return {
            success: result.success,
            logs: result.logs,
            error: result.error,
            httpTrafficLog: result.httpTrafficLog,
        };
    }
}
