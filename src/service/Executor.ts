import { VectorCollectionFactory } from "../db/vectordb/VectorCollectionFactory.ts";
import { Logger } from "../Logger.ts";
import * as types from "../types/index.ts";
import type { DocFile } from "../types/file.ts";
import { EmbeddingService } from "./EmbeddingService.ts";
import { FileService } from "./FileService.ts";
import { ProjectRepository } from "./ProjectRepository.ts";
import { PromptService } from "./PromptService.ts";
import { TestSuiteRepository } from "./TestSuiteRepository.ts";
import { DockerExecutor } from "./DockerExecutor.ts";
import { ReportRepository } from "./ReportRepository.ts";
import { ConfigService } from "./ConfigService.ts";
import { isEnvironmentError, parseImportedPackages } from "../sandbox/depDetect.ts";
import { JobCancelledError } from "../types/job.ts";
import {
    CorpusFile,
    corpusFromFiles,
    corpusMentions,
    extractMissingModule,
    verifyFragment,
} from "../feedback/fragmentVerify.ts";

/** Throw if a cancellation signal has fired — used at execution checkpoints. */
function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new JobCancelledError();
}

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
            timeoutMs: sb.stepTimeoutMs,
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
            onProgress?.(JSON.stringify({ type: "log", content: `TestSuite ${testSuiteId} not found` }));
            return null;
        }

        const project = await this.projectRepository.get(testSuite.projectId);
        if (!project) {
            this.logger.error(new Error("Not found"), `Project ${testSuite.projectId} not found (referenced by TestSuite ${testSuiteId})`);
            onProgress?.(JSON.stringify({ type: "log", content: `Project ${testSuite.projectId} not found` }));
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
            return await this.executeCodeGeneration(testSuite as unknown as types.test.TestSuite, validFiles, startTime, onProgress, signal);
        } else {
            return await this.executeTestScenario(testSuite as unknown as types.test.TestSuite, validFiles, startTime, onProgress, signal);
        }
    }

    private async executeCodeGeneration(
        testSuite: types.test.TestSuite,
        files: DocFile[],
        startTime: number,
        onProgress?: (msg: string) => void,
        signal?: AbortSignal,
    ) {
        onProgress?.(
            JSON.stringify({ type: "log", content: "Starting Agentic RAG for CODE_GENERATION..." }),
        );
        const {
            response: codeGenResponse,
            history: conversationHistory,
            contextFound: usedDocsContext,
            coverageReport,
            frictionEvents,
        } = await this.promptService.promptForCodeGenerationWithAgenticRAG(
            testSuite.projectId,
            testSuite.userGoal || "No goal specified",
            files,
            onProgress,
            async (code) => {
                const execResult = await this.runStepInDocker(
                    code,
                    this.parseInitialContext(testSuite.initialContext)
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

        const corpus = corpusFromFiles(files);
        const ctx = this.parseInitialContext(testSuite.initialContext);

        // Run all generated examples through Docker concurrently — they are
        // independent programs that do not share state.
        throwIfAborted(signal);
        onProgress?.(JSON.stringify({
            type: "log",
            content: `Running ${codeGenResponse.examples.length} Docker containers in parallel…`,
        }));

        const execResults = await Promise.all(
            codeGenResponse.examples.map((example, idx) => {
                this.logger.log(`Executing generated example ${idx + 1}: ${example.title}`);
                return this.runStepInDocker(example.fullProgram, ctx);
            }),
        );

        // Build step reports (preserving original order).
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
            if (!execResult.success) {
                stepReport.error = typeof execResult.error === "object"
                    ? JSON.stringify(execResult.error)
                    : String(execResult.error);
            }
            return stepReport;
        });

        // Analyse failures concurrently — each is an independent LLM call.
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

    /** SUCCESS when all steps passed, FAILED when all failed, PARTIAL_FAILURE otherwise. */
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

    /**
     * Diagnose a failed step.
     *
     * Environment/tooling failures are classified without an LLM — but a missing
     * dependency that the documentation itself references is a docs gap (CONFIG),
     * not an environment problem: the docs told the reader to use something
     * without working install/setup instructions.
     *
     * Genuine failures go to the LLM documentation-gap classifier with both the
     * RAG-retrieved related docs and the documentation context the generator
     * actually used. The classifier's pinpointed fragment is then verified
     * against the real corpus (file + line range + match score).
     */
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
                return `--- DOCUMENT: ${fileName}${line} ---\n${payload.content || JSON.stringify(k)}`;
            })
            .join("\n\n").substring(0, 15000);

        // Include the documentation the generator actually worked from, so the
        // classifier can pinpoint the fragment that misled the code — not only
        // whatever a post-hoc search happens to retrieve.
        if (usedDocsContext) {
            relatedDocsText += `\n\n--- DOCUMENTATION CONTEXT USED DURING GENERATION (truncated) ---\n` +
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

        // Ground the pinpointed fragment in the real files (anti-hallucination).
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

    /**
     * Deterministic classification of environment-looking errors.
     *
     * Upgrade logic (#23):
     *  1. Missing module that the docs MENTION and DESCRIBE INSTALLING → CONFIG.
     *     Docs reference the package in a code import/usage context without working
     *     install instructions — that's a documentation gap.
     *  2. Missing module the docs MENTION but only incidentally (no install context)
     *     → still CONFIG, because the reader follows the docs and hits a missing dep.
     *  3. Missing module the docs DON'T mention at all → ENVIRONMENT.
     *     The LLM hallucinated the import; no documentation change required.
     *  4. Anything else (sandbox limits, permissions, ENOSPC) → ENVIRONMENT.
     */
    private classifyEnvironmentError(
        error: string,
        corpus: CorpusFile[],
    ): types.report.FailureAnalysis {
        const missingModule = extractMissingModule(error);

        if (missingModule && corpusMentions(corpus, missingModule)) {
            // Check whether the docs provide installation instructions (install/npm/yarn/pip).
            const installKeywords = ["npm install", "yarn add", "pip install", "install ", "import ", "require("];
            let hasInstallContext = false;
            let verification: types.report.FragmentVerification = { verified: false, matchScore: 0 };

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
                    // Look at the surrounding ±5 lines for install instructions.
                    const window = lines.slice(Math.max(0, idx - 5), Math.min(lines.length, idx + 6));
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
                suggestedDocsFix:
                    `Add explicit installation instructions for "${missingModule}" ` +
                    `(exact package name and install command, e.g. \`npm install ${missingModule}\`) ` +
                    `near its first usage in the docs.`,
                confidence: 1,
                votes: 0,
                fragmentVerification: verification,
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
            this.logger.error(new Error("Invalid JSON"), `initialContext is not valid JSON: "${raw.slice(0, 120)}" — using empty context`);
            return {};
        }
    }

    /**
     * Run a single user-code step in Docker.
     * Returns structured result, full logs, and captured HTTP traffic.
     */
    private async runStepInDocker(
        userCode: string,
        currentCtx: unknown,
    ): Promise<{
        success: boolean;
        result?: { ctx: unknown; result: unknown };
        error?: unknown;
        logs: string;
        httpTrafficLog?: types.report.HttpTrafficEntry[];
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

// HTTP traffic interceptor — monkey-patches globalThis.fetch so all HTTP
// requests made by user code are captured for failure analysis.
const __httpLog = [];
const __origFetch = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
if (__origFetch) {
    globalThis.fetch = async (url, opts = {}) => {
        const __start = Date.now();
        const __entry = {
            method: (opts?.method || 'GET').toUpperCase(),
            url: String(url),
            requestBody: null,
            responseStatus: null,
            responseBody: null,
            durationMs: null,
            error: null,
        };
        if (opts?.body) {
            try { __entry.requestBody = typeof opts.body === 'string' ? opts.body.slice(0, 500) : JSON.stringify(opts.body).slice(0, 500); } catch {}
        }
        try {
            const __res = await __origFetch(url, opts);
            __entry.responseStatus = __res.status;
            __entry.durationMs = Date.now() - __start;
            try { const __clone = __res.clone(); __entry.responseBody = (await __clone.text()).slice(0, 1000); } catch {}
            __httpLog.push(__entry);
            return __res;
        } catch (__e) {
            __entry.error = __e.message ?? String(__e);
            __entry.durationMs = Date.now() - __start;
            __httpLog.push(__entry);
            throw __e;
        }
    };
}

;(async () => {
    const __emitHttpLog = () => {
        if (__httpLog.length > 0) {
            console.log("___HTTP_LOG_START___");
            console.log(JSON.stringify(__httpLog));
            console.log("___HTTP_LOG_END___");
        }
    };
    try {
        const userModule = await import('./userStep.js');
        const runFunc = typeof userModule.default === 'function' ? userModule.default : (ctx) => { /* no-op */ };
        const output = await runFunc(ctx);
        console.log("___RESULT_START___");
        console.log(JSON.stringify(output || { result: null, ctx }));
        console.log("___RESULT_END___");
        __emitHttpLog();
    } catch (e) {
        __emitHttpLog();

        // Safe JSON serialiser — handles circular references (e.g. axios error objects
        // contain Socket→ClientRequest→socket cycles that blow up naive JSON.stringify).
        const __safeJson = (obj) => {
            const seen = new WeakSet();
            return JSON.stringify(obj, (key, value) => {
                if (typeof value === 'object' && value !== null) {
                    if (seen.has(value)) return '[Circular]';
                    seen.add(value);
                }
                // Drop Node.js internal socket/stream objects — they're never useful in a
                // failure report and are almost always the source of circular references.
                if (value && typeof value === 'object' &&
                    (value.constructor?.name === 'Socket' ||
                     value.constructor?.name === 'TLSSocket' ||
                     value.constructor?.name === 'ClientRequest' ||
                     value.constructor?.name === 'IncomingMessage')) {
                    return '[Stream]';
                }
                return value;
            });
        };

        let serializableError = {};

        // Axios errors: the most useful fields are in e.response and e.config.
        // The full error object has circular refs via e.request (Socket) — never copy it.
        if (e && (e.isAxiosError === true || (e.response && e.config))) {
            serializableError = {
                message: e.message,
                name: e.name || 'AxiosError',
                // HTTP response details — the primary signal for failure analysis
                status: e.response?.status ?? null,
                statusText: e.response?.statusText ?? null,
                responseData: e.response?.data ?? null,
                responseHeaders: e.response?.headers
                    ? Object.fromEntries(Object.entries(e.response.headers).slice(0, 10))
                    : null,
                // Request details — useful for identifying the wrong endpoint/method
                requestUrl: e.config?.url ?? null,
                requestMethod: e.config?.method?.toUpperCase() ?? null,
                requestBaseURL: e.config?.baseURL ?? null,
                // Stack for unexpected axios errors (e.g. network timeout)
                stack: e.stack?.split('\\n').slice(0, 6).join('\\n') ?? null,
            };
        } else if (e instanceof Error) {
            serializableError = {
                message: e.message,
                name: e.name,
                stack: e.stack?.split('\\n').slice(0, 8).join('\\n'),
                cause: e.cause instanceof Error ? e.cause.message : e.cause,
            };
            // Copy any additional plain-value own properties (e.g. e.code = 'ENOTFOUND')
            for (const key of Object.keys(e)) {
                if (!['request', 'response', 'config', 'socket'].includes(key)) {
                    try {
                        const val = (e)[key];
                        if (typeof val !== 'function' && typeof val !== 'object') {
                            serializableError[key] = val;
                        }
                    } catch {}
                }
            }
        } else if (typeof e === 'object' && e !== null) {
            serializableError = { message: String(e) };
        } else {
            serializableError = { message: String(e) };
        }

        try {
            console.error(__safeJson(serializableError));
        } catch {
            // Last-resort fallback if even the safe serialiser fails
            console.error(JSON.stringify({ message: String(e?.message ?? e), name: String(e?.name ?? 'Error') }));
        }
        process.exit(1);
    }
})();
`;

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

            const stdout = execResult.stdout;
            const startMarker = "___RESULT_START___";
            const endMarker = "___RESULT_END___";
            const startIndex = stdout.indexOf(startMarker);
            const endIndex = stdout.indexOf(endMarker);

            if (startIndex === -1 || endIndex === -1) {
                return { success: true, result: { ctx: currentCtx, result: null }, logs: fullLogs, httpTrafficLog };
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

    /** Parse `___HTTP_LOG_START___` … `___HTTP_LOG_END___` from Docker stdout. */
    private parseHttpLog(stdout: string): types.report.HttpTrafficEntry[] | undefined {
        const start = stdout.indexOf("___HTTP_LOG_START___");
        const end   = stdout.indexOf("___HTTP_LOG_END___");
        if (start === -1 || end === -1) return undefined;
        try {
            const json = stdout.substring(start + "___HTTP_LOG_START___".length, end).trim();
            return JSON.parse(json) as types.report.HttpTrafficEntry[];
        } catch {
            return undefined;
        }
    }

    /**
     * Execute a raw JS code snippet (e.g. a documentation code example) without
     * wrapping it in a full test-suite execution. Used by the master-plan doc-examples phase.
     */
    public async runDocExample(code: string): Promise<{
        success: boolean;
        logs: string;
        error?: unknown;
        httpTrafficLog?: types.report.HttpTrafficEntry[];
    }> {
        const result = await this.runStepInDocker(code, {});
        return {
            success: result.success,
            logs: result.logs,
            error: result.error,
            httpTrafficLog: result.httpTrafficLog,
        };
    }
}
