import OpenAI from "@openai/openai";
import { Injectable, InjectParam } from "../ioc/decorator.ts";
import { Logger } from "../Logger.ts";
import { EmbeddingService } from "./EmbeddingService.ts";
import { VectorCollectionFactory } from "../db/vectordb/VectorCollectionFactory.ts";
import * as types from "../types/index.ts";
import type { DocFile } from "../types/file.ts";
import { ConfigService } from "./ConfigService.ts";
import { TraceRepository } from "../db/mongo/TraceRepository.ts";
import {
    GET_ENDPOINT_TOOL,
    GREP_CORPUS_TOOL,
    GREP_FILE_TOOL,
    HEAD_FILE_TOOL,
    LIST_FILES_TOOL,
    OUTLINE_FILE_TOOL,
    READ_FILE_TOOL,
    READ_SECTION_TOOL,
    SEARCH_TOOL,
    SMOKE_TEST_TOOL,
    TAIL_FILE_TOOL,
} from "./prompt/constants.ts";
import { emitLog, emitToken, ProgressCallback } from "./prompt/helpers.ts";
import {
    CodeGenerationResponse,
    PromptOptions,
    RouterPlanResponse,
    SmokeTestCallback,
    SmokeTestToolArgs,
    StructuredResponse,
} from "./prompt/types.ts";
import * as templates from "./prompt/templates.ts";
import { runAgenticLoop } from "./prompt/agenticLoop.ts";
import { coerceJson } from "../llm/StructuredLlm.ts";
import * as schemas from "../llm/schemas.ts";
import { llmParams, loopParams, makeStructured, type StructuredFn } from "./prompt/llm.ts";
import { createSearchSession } from "./prompt/SearchSession.ts";
import { VfsTools } from "./prompt/VfsTools.ts";
import { FailureClassifier } from "./prompt/FailureClassifier.ts";
import { RagSearch } from "./prompt/RagSearch.ts";

export type { CodeGenerationResponse, PromptOptions, StructuredResponse } from "./prompt/types.ts";

@Injectable()
export class PromptService {
    /** Hybrid retrieval + rerank + relevance-aware truncation. */
    private readonly ragSearch: RagSearch;
    /** Virtual-file-system tools exposed to the research agents. */
    private readonly vfsTools: VfsTools;
    /** Self-consistency documentation-gap classification + query refinement. */
    private readonly failureClassifier: FailureClassifier;
    /** Structured-output closure bound to the configured LLM. */
    private readonly structured: StructuredFn;

    constructor(
        // Two distinct OpenAI instances share one type; resolve this one by name.
        @InjectParam("openai") private openai: OpenAI,
        private logger: Logger,
        embeddingService: EmbeddingService,
        vectorCollectionFactory: VectorCollectionFactory,
        private configService: ConfigService,
        private traceRepository: TraceRepository,
    ) {
        this.ragSearch = new RagSearch(
            openai,
            embeddingService,
            vectorCollectionFactory,
            configService,
            logger,
        );
        this.vfsTools = new VfsTools(configService);
        this.failureClassifier = new FailureClassifier(openai, configService, logger);
        this.structured = makeStructured(openai, configService, logger);
    }

    /** Common deterministic generation params (temperature/seed) for raw chat calls. */
    private llmParams(): Record<string, unknown> {
        return llmParams(this.configService);
    }

    /** Extra knobs for the agentic loop config (determinism + retry + token budget). */
    private loopParams(): Record<string, unknown> {
        return loopParams(this.configService);
    }

    /**
     * Guarded `search_knowledge_base` handler with per-phase session memory:
     * chunks already returned are stubbed instead of re-serialised, and repeated
     * queries yielding nothing new steer the agent toward the file tools or
     * concluding. One session per agent phase (the KB is immutable within a run).
     */
    private createSearchHandler(
        vectorCollectionName: string,
        logLabel: string,
        onProgress?: ProgressCallback,
    ) {
        return createSearchSession({
            search: (q) =>
                this.ragSearch.search(
                    vectorCollectionName,
                    q,
                    this.configService.values.limits.defaultSearchLimit,
                ),
            maxResultChars: this.configService.values.limits.maxResultChars,
            logLabel,
            onProgress,
        }).handler;
    }

    public async promptForApiUsageScenario(
        vectorCollectionName: string,
        files: DocFile[],
        startingContext: string,
        options: PromptOptions = {},
        onProgress?: ProgressCallback,
    ): Promise<StructuredResponse> {
        const goal = `Generate a comprehensive test scenario. Preferences: ${
            options.userPreferences || "None"
        }. Steps: ${options.minimalLength || 10}-${options.maximalLength || 20}.`;

        // 1. Router
        const plan = await this.promptForExecutionPlan(vectorCollectionName, goal, onProgress);
        const planStepsStr = plan.steps.map((s) => `- ${s.stepExplanation} (Action: ${s.action})`)
            .join("\n");

        // 2. Research / Exploration using agentic loop
        const systemPrompt = `You are a Research Agent planning a test scenario. 
Your goal is to gather the exact API functions and context needed.
Follow this plan:
${planStepsStr}

When you have found all necessary functions and endpoints, reply with EXACTLY "READY_FOR_GENERATION".`;

        const messages: import("@openai/openai").default.Chat.ChatCompletionMessageParam[] = [
            { role: "system", content: systemPrompt },
            {
                role: "user",
                content: `Start your research to generate a ${options.minimalLength || 10}-${
                    options.maximalLength || 20
                } steps scenario.`,
            },
        ];

        const toolHandlers = {
            search_knowledge_base: this.createSearchHandler(
                vectorCollectionName,
                "Agent searching",
                onProgress,
            ),
            ...this.vfsTools.createHandlers(files, onProgress),
        };

        const traceTracker = await this.createTraceTracker("Research Phase", goal);

        const finalMessages = await runAgenticLoop(this.openai, this.logger, onProgress, {
            modelName: this.configService.values.openAI.modelName,
            messages,
            tools: [
                SEARCH_TOOL,
                LIST_FILES_TOOL,
                READ_FILE_TOOL,
                HEAD_FILE_TOOL,
                TAIL_FILE_TOOL,
                GREP_FILE_TOOL,
            ],
            toolHandlers,
            readySignal: "READY_FOR_GENERATION",
            maxIterations: this.configService.values.limits.maxResearchIterations,
            maxContextChars: this.configService.values.limits.maxContextChars,
            phaseLabel: "Scenario Research",
            ...this.loopParams(),
            onTrace: traceTracker,
        });

        // 3. Generation Phase
        const agentSynthesis = finalMessages
            .filter((m) => m.role === "assistant" && typeof m.content === "string" && m.content)
            .map((m) => m.content as string)
            .join("\n\n");

        const toolResults = finalMessages
            .filter((m) => m.role === "tool")
            .map((m) => typeof m.content === "string" ? m.content : "")
            .join("\n\n");

        const contextFound = (agentSynthesis + "\n\n" + toolResults).substring(
            0,
            this.configService.values.limits.maxContextChars,
        );

        const genSystemPrompt = templates.createSystemPrompt(options.mandatoryImports);
        const userPrompt = templates.createUserPrompt(
            contextFound,
            startingContext,
            options.minimalLength || 10,
            options.maximalLength || 20,
            options.userPreferences,
        );

        try {
            const stepRange = `${options.minimalLength || 10}-${options.maximalLength || 20}`;
            this.logger.log(`Prompting OpenAI (Steps: ${stepRange})...`);
            emitLog(onProgress, `Prompting OpenAI (Steps: ${stepRange})...`);

            return await this.structured(
                genSystemPrompt,
                userPrompt,
                schemas.ScenarioSchema,
            ) as StructuredResponse;
        } catch (error) {
            this.logger.error(error, "Error communicating with OpenAI");
            throw new Error("Failed to get response from OpenAI.");
        }
    }

    public async promptForExecutionPlan(
        vectorCollectionName: string,
        userGoal: string,
        onProgress?: ProgressCallback,
    ): Promise<RouterPlanResponse> {
        this.logger.log(`Routing/Planning steps for goal: "${userGoal}"`);
        emitLog(onProgress, `Analyzing task and planning execution steps...`);

        const initialSearchResults = await this.ragSearch.search(
            vectorCollectionName,
            userGoal,
            this.configService.values.limits.defaultSearchLimit,
        );
        const initialDocsContent = this.ragSearch.formatResults(initialSearchResults);

        try {
            return await this.structured(
                templates.ROUTER_SYSTEM_PROMPT,
                templates.createRouterUserPrompt(initialDocsContent, userGoal),
                schemas.RouterPlanSchema,
            ) as RouterPlanResponse;
        } catch (error) {
            this.logger.error(error, "Failed to generate execution plan");
            return { steps: [] };
        }
    }

    public async promptForCodeGenerationWithAgenticRAG(
        vectorCollectionName: string,
        userGoal: string,
        files: DocFile[],
        onProgress?: ProgressCallback,
        smokeTestCallback?: SmokeTestCallback,
        /** JSON string with the runtime `ctx` (apiBase, credentials…). Rendered
         *  into the verification+generation prompts so code targets ctx.apiBase
         *  instead of the docs' literal localhost addresses. */
        initialContext?: string,
        /** Docs-ablation arm: when true, NO documentation is retrieved (no RAG,
         *  no research/bounce). The agent must rely on its parametric knowledge —
         *  `pass_with − pass_without` measures the documentation's value. */
        withoutDocs?: boolean,
    ): Promise<{
        response: CodeGenerationResponse;
        history: any[];
        /** Documentation context the generator actually worked from. */
        contextFound: string;
        /** Research-phase per-subtask coverage breakdown (undefined on extraction failure). */
        coverageReport?: types.report.CoverageItem[];
        /** Friction signals captured mid-run (smoke-test failures, research bounces). */
        frictionEvents: types.report.FrictionEvent[];
    }> {
        this.logger.log(`Starting Agentic RAG for goal: "${userGoal}"`);
        emitLog(onProgress, `Starting Agentic RAG for goal: "${userGoal}"`);

        const frictionEvents: types.report.FrictionEvent[] = [];
        const envBlock = templates.executionEnvironmentBlock(initialContext);

        let initialDocsContent = "";
        let contextFound = "";
        let researchMessages: import("@openai/openai").default.Chat.ChatCompletionMessageParam[] =
            [];
        if (withoutDocs) {
            // Ablation: withhold all documentation; the agent works from its own
            // knowledge only. No retrieval, no research/bounce loop.
            contextFound =
                "NO DOCUMENTATION IS PROVIDED. Rely solely on your own knowledge of the " +
                "library. Do not assume undocumented behaviour.";
            emitLog(onProgress, "Docs ablation: generating WITHOUT documentation (no RAG).");
        } else {
            ({ initialDocsContent, contextFound, messages: researchMessages } = await this
                .runResearchPhase(
                    vectorCollectionName,
                    userGoal,
                    files,
                    onProgress,
                ));
        }

        // The research agent's explicit COVERED / NEEDS RESEARCH gap analysis is
        // documentation feedback in its own right — extract and persist it.
        const coverageReport = withoutDocs
            ? undefined
            : await this.extractCoverageReport(researchMessages);

        let verificationMessages:
            import("@openai/openai").default.Chat.ChatCompletionMessageParam[] = [];
        let isVerified = false;
        let feedbackIterations = 0;
        const maxFeedbackLoops = 3;

        while (!isVerified && feedbackIterations < maxFeedbackLoops) {
            verificationMessages = await this.runVerificationPhase(
                vectorCollectionName,
                initialDocsContent,
                contextFound,
                userGoal,
                onProgress,
                smokeTestCallback,
                frictionEvents,
                envBlock,
            );

            const lastMessage = verificationMessages[verificationMessages.length - 1];
            const content = lastMessage.content;

            // In the ablation arm there is no corpus to search — never bounce.
            if (
                !withoutDocs && typeof content === "string" && content.includes("NEEDS_RESEARCH:")
            ) {
                const queryMatch = content.match(/NEEDS_RESEARCH:\s*(.*)/);
                if (queryMatch && queryMatch[1]) {
                    const query = queryMatch[1].trim();
                    this.logger.log(`Verification agent requested more research: "${query}"`);
                    emitLog(onProgress, `Verification agent requested more research: "${query}"`);

                    // #21 — Extract the agent's gap analysis prose from the bounce.
                    // The agent typically writes a diagnostic paragraph before NEEDS_RESEARCH:
                    // e.g. "The documentation is missing the auth header format..."
                    // Capture this as the friction note so it isn't buried in raw traces.
                    const analysisNote = this.extractGapAnalysisFromBounce(content);

                    frictionEvents.push({
                        type: "RESEARCH_BOUNCE",
                        query,
                        note: analysisNote ||
                            "Verification could not proceed with the researched documentation and had to search again.",
                    });

                    const additionalDocs = await this.ragSearch.search(
                        vectorCollectionName,
                        query,
                        this.configService.values.limits.defaultSearchLimit,
                    );
                    const formattedAdditionalDocs = JSON.stringify(additionalDocs.map((r) => ({
                        ...r,
                        payload: r.payload
                            ? {
                                ...r.payload,
                                content: (r.payload.content || "").substring(
                                    0,
                                    this.configService.values.limits.maxResultChars,
                                ),
                            }
                            : r.payload,
                    })));

                    contextFound += `\n\n### ADDITIONAL RAG SEARCH RESULTS FOR "${query}" ###\n` +
                        formattedAdditionalDocs;
                    feedbackIterations++;
                    continue;
                }
            }

            isVerified = true;
        }

        const response = await this.runGenerationPhase(verificationMessages, onProgress, envBlock);
        const fullHistory = [...researchMessages, ...verificationMessages];

        return {
            response,
            history: this.cleanHistoryForReport(fullHistory),
            contextFound,
            coverageReport,
            frictionEvents,
        };
    }

    /**
     * Extract the research agent's per-subtask coverage state (COVERED /
     * NEEDS RESEARCH) from the research transcript into structured data.
     * Returns undefined when extraction fails — never blocks the pipeline.
     */
    private async extractCoverageReport(
        researchMessages: OpenAI.Chat.ChatCompletionMessageParam[],
    ): Promise<types.report.CoverageItem[] | undefined> {
        try {
            const transcript = researchMessages
                .filter((m) => m.role === "assistant" && typeof m.content === "string" && m.content)
                .map((m) => m.content as string)
                .join("\n\n")
                .substring(0, 20_000);
            if (transcript.trim().length === 0) return undefined;

            const searchQueries: string[] = [];
            for (const m of researchMessages) {
                const toolCalls =
                    (m as { tool_calls?: { function?: { name?: string; arguments?: string } }[] })
                        .tool_calls;
                for (const tc of toolCalls ?? []) {
                    if (tc.function?.name === "search_knowledge_base" && tc.function.arguments) {
                        try {
                            const args = JSON.parse(tc.function.arguments);
                            if (typeof args.query === "string") searchQueries.push(args.query);
                        } catch { /* malformed args — skip */ }
                    }
                }
            }

            const parsed = await this.structured(
                templates.COVERAGE_EXTRACTION_SYSTEM_PROMPT,
                templates.createCoverageExtractionUserPrompt(transcript, searchQueries),
                schemas.CoverageReportSchema,
            );
            return parsed.items.length > 0 ? parsed.items : undefined;
        } catch (error) {
            this.logger.error(error, "Coverage report extraction failed (non-fatal)");
            return undefined;
        }
    }

    private cleanHistoryForReport(
        messages: OpenAI.Chat.ChatCompletionMessageParam[],
    ): OpenAI.Chat.ChatCompletionMessageParam[] {
        return messages.map((m) => {
            // Spread into a mutable copy; use the assistant message sub-type to access tool_calls.
            if (m.role === "assistant") {
                const clean: OpenAI.Chat.ChatCompletionAssistantMessageParam = { ...m };
                if (typeof clean.content === "string") {
                    clean.content = clean.content.replace(
                        /```[\s\S]*?```/g,
                        "[Generated Code Block]",
                    );
                }
                if (Array.isArray(clean.tool_calls)) {
                    clean.tool_calls = clean.tool_calls.map((tc) => {
                        // Narrow away custom tool calls (which have no `.function`).
                        if (!("function" in tc)) return tc;
                        const fn = tc.function;
                        if (fn?.name === "smoke_test_code" && fn?.arguments) {
                            try {
                                const args = JSON.parse(fn.arguments) as Record<string, unknown>;
                                if (args.code) args.code = "[Code Snippet Truncated]";
                                return {
                                    ...tc,
                                    function: { ...fn, arguments: JSON.stringify(args) },
                                };
                            } catch {
                                return tc;
                            }
                        }
                        return tc;
                    });
                }
                return clean;
            }
            return m;
        });
    }

    private async runResearchPhase(
        vectorCollectionName: string,
        userGoal: string,
        files: DocFile[],
        onProgress: ProgressCallback,
    ): Promise<
        {
            initialDocsContent: string;
            contextFound: string;
            messages: OpenAI.Chat.ChatCompletionMessageParam[];
        }
    > {
        const initialSearchResults = await this.ragSearch.search(
            vectorCollectionName,
            userGoal,
            this.configService.values.limits.defaultSearchLimit,
        );
        const initialDocsContent = this.ragSearch.formatResults(initialSearchResults);

        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: "system", content: templates.RESEARCH_SYSTEM_PROMPT },
            {
                role: "user",
                content: templates.createResearchUserPrompt(initialDocsContent, userGoal),
            },
        ];

        const traceTracker = await this.createTraceTracker("Agentic RAG Research", userGoal);

        const finalMessages = await runAgenticLoop(this.openai, this.logger, onProgress, {
            messages,
            // VFS tools are advertised in the research prompt — register them here
            // so the agent can read full files instead of only truncated search chunks.
            tools: [
                SEARCH_TOOL,
                LIST_FILES_TOOL,
                READ_FILE_TOOL,
                HEAD_FILE_TOOL,
                TAIL_FILE_TOOL,
                GREP_FILE_TOOL,
                GREP_CORPUS_TOOL,
                OUTLINE_FILE_TOOL,
                READ_SECTION_TOOL,
                GET_ENDPOINT_TOOL,
            ],
            toolHandlers: {
                search_knowledge_base: this.createSearchHandler(
                    vectorCollectionName,
                    "Agent RAG searching knowledge base for",
                    onProgress,
                ),
                ...this.vfsTools.createHandlers(files, onProgress),
            },
            modelName: this.configService.values.openAI.modelName,
            readySignal: "READY_FOR_GENERATION",
            maxIterations: this.configService.values.limits.maxResearchIterations,
            maxContextChars: this.configService.values.limits.maxContextChars,
            phaseLabel: "Agentic RAG Research",
            ...this.loopParams(),
            onTrace: traceTracker,
        });

        const agentSynthesis = finalMessages
            .filter((m) => m.role === "assistant" && typeof m.content === "string" && m.content)
            .map((m) => m.content as string)
            .join("\n\n");

        const toolResults = finalMessages
            .filter((m) => m.role === "tool")
            .map((m) => typeof m.content === "string" ? m.content : "")
            .join("\n\n");

        const contextFound = (agentSynthesis + "\n\n" + toolResults).substring(
            0,
            this.configService.values.limits.maxContextChars,
        );

        return { initialDocsContent, contextFound, messages: finalMessages };
    }

    private async runVerificationPhase(
        vectorCollectionName: string,
        initialDocsContent: string,
        contextFound: string,
        userGoal: string,
        onProgress: ProgressCallback,
        smokeTestCallback?: SmokeTestCallback,
        frictionEvents?: types.report.FrictionEvent[],
        /** Rendered executionEnvironmentBlock() — "" when there is no runtime ctx. */
        envBlock = "",
    ): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
        // Smartly prune documentation before verification to stay within token budget
        const query = userGoal.substring(0, 2000);
        const maxDocsChars = this.configService.values.limits.maxScenarioDocsChars;

        const combinedRaw =
            `#### Initial Documentation:\n${initialDocsContent}\n\n#### Researched Documentation:\n${contextFound}`;
        const smartDocs = await this.ragSearch.rankAndFilterDocs(combinedRaw, query, maxDocsChars);

        this.logger.log(`Agentic RAG Verification Phase (Smoke Testing)...`);
        emitLog(onProgress, `Agentic RAG Verification Phase... Smoke testing examples in Docker.`);

        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: "system", content: templates.VERIFICATION_SYSTEM_PROMPT + envBlock },
            {
                role: "user",
                content: templates.createVerificationUserPrompt(
                    "", // Doc fragments now in contextFound string passed as smartDocs
                    smartDocs,
                    userGoal,
                    maxDocsChars,
                ),
            },
        ];

        const traceTracker = await this.createTraceTracker("Verification Phase", userGoal);

        return runAgenticLoop(this.openai, this.logger, onProgress, {
            messages,
            tools: [SMOKE_TEST_TOOL, SEARCH_TOOL],
            toolHandlers: {
                search_knowledge_base: this.createSearchHandler(
                    vectorCollectionName,
                    "Agent RAG searching knowledge base (Verification phase) for",
                    onProgress,
                ),
                smoke_test_code: async (_id, rawArgs) => {
                    const args = rawArgs as SmokeTestToolArgs;
                    emitLog(
                        onProgress,
                        `Running Smoke Test...`,
                    );

                    let testResult = "Tool not available locally.";
                    if (smokeTestCallback) {
                        try {
                            testResult = await smokeTestCallback(
                                args.code,
                            );
                        } catch (e) {
                            testResult = `FATAL RUNTIME ERROR: ${
                                e instanceof Error ? e.message : String(e)
                            }`;
                        }
                    }

                    const status = testResult.startsWith("SUCCESS") ? "Passed" : "Failed";
                    emitLog(onProgress, `Smoke Test ${status}:\n${testResult}`);

                    // A failed smoke test the agent later works around is friction
                    // the final pass/fail status would otherwise hide — record it.
                    if (status === "Failed" && frictionEvents) {
                        frictionEvents.push({
                            type: "SMOKE_TEST_FAILURE",
                            error: testResult.substring(0, 600),
                        });
                    }

                    return testResult;
                },
            },
            modelName: this.configService.values.openAI.modelName,
            readySignal: "VERIFICATION_COMPLETE",
            maxIterations: this.configService.values.limits.maxVerificationIterations,
            maxContextChars: this.configService.values.limits.maxContextChars,
            phaseLabel: "Verification",
            ...this.loopParams(),
            onTrace: traceTracker,
        });
    }

    private async runGenerationPhase(
        verificationMessages: OpenAI.Chat.ChatCompletionMessageParam[],
        onProgress: ProgressCallback,
        /** Rendered executionEnvironmentBlock() — "" when there is no runtime ctx. */
        envBlock = "",
    ): Promise<CodeGenerationResponse> {
        this.logger.log(`Agentic RAG Generation Phase...`);
        emitLog(
            onProgress,
            `Agentic RAG Finalizing Phase... Formatting verified code into final response.`,
        );

        // Preserve a larger window of context to avoid hallucinations
        const verificationCompleteIdx = verificationMessages.findLastIndex((m) =>
            typeof m.content === "string" && m.content.includes("VERIFICATION_COMPLETE")
        );

        const lastFewMessagesStart = Math.max(0, verificationCompleteIdx - 10);

        const relevantMessages = verificationMessages.filter((m, i, arr) => {
            if (m.role === "system" || (m.role === "user" && i <= 1)) return true;

            // Keep the last 10 messages of the verification phase for context
            if (i >= lastFewMessagesStart) return true;

            // Also keep any successful tool results leading up to it
            if (
                m.role === "tool" && typeof m.content === "string" &&
                m.content.startsWith("SUCCESS")
            ) return true;

            return false;
        });

        const testedHistory = relevantMessages
            .map((m) => {
                const parts = [`ROLE: ${m.role}`];
                if (m.content) parts.push(m.content as string);
                if (m.role === "assistant" && m.tool_calls) {
                    parts.push(JSON.stringify(m.tool_calls));
                }
                return parts.join("\n");
            })
            .join("\n\n---\n");

        const genUserPrompt =
            `### TESTED EXAMPLES HISTORY:\n${testedHistory}\n\n### TASK\nExtract the working examples from the history above and format them precisely into the requested JSON structure.`;

        // Respect structuredOutputMode: only set json_object response_format when
        // the mode actually supports it. "text" and "json_schema" modes must not
        // include this field — it would cause an API error on those servers.
        const structuredMode = this.configService.values.llm.structuredOutputMode;
        const responseFormat = structuredMode === "json_object"
            ? { response_format: { type: "json_object" } }
            : {};

        const genResponse: any = await this.openai.chat.completions.create({
            model: this.configService.values.openAI.modelName,
            messages: [
                { role: "system", content: templates.GENERATION_SYSTEM_PROMPT + envBlock },
                { role: "user", content: genUserPrompt },
            ],
            ...responseFormat,
            stream: true,
            ...this.llmParams(),
        } as any);

        let jsonString = "";
        for await (const chunk of genResponse) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
                jsonString += content;
                emitToken(onProgress, content);
            }
        }

        // Validate the streamed JSON; if malformed, do one non-streaming repair pass.
        const coerced = coerceJson(jsonString, schemas.CodeGenerationSchema);
        if (coerced.ok) return coerced.data as CodeGenerationResponse;

        this.logger.error(`Streamed generation JSON invalid (${coerced.error}); repairing...`);
        return await this.structured(
            templates.GENERATION_SYSTEM_PROMPT + envBlock,
            genUserPrompt,
            schemas.CodeGenerationSchema,
        ) as CodeGenerationResponse;
    }

    /** Rerank hybrid-retrieval results (no-op unless `reranker.mode` is set). */
    public rerankSearchResults(
        query: string,
        results: types.vector.SearchResult<types.file.FileShard>[],
        limit: number,
    ): Promise<types.vector.SearchResult<types.file.FileShard>[]> {
        return this.ragSearch.rerank(query, results, limit);
    }

    /** Turn a crash + context into a sharper RAG query (delegates to FailureClassifier). */
    public refineSearchQuery(error: string, context: string): Promise<string> {
        return this.failureClassifier.refineSearchQuery(error, context);
    }

    /** Classify a documentation-gap failure via self-consistency voting. */
    public classifyFailure(
        errorMessage: string,
        scriptContent: string,
        relatedDocs: string,
        stepDescription: string,
        options: {
            /**
             * Scores a candidate's pinpointed fragment against the real docs corpus
             * (0..1). Used to break ties between same-category candidates in favour
             * of verifiable (non-hallucinated) quotes.
             */
            fragmentScorer?: (fragment: string | undefined) => number;
        } = {},
        httpTrafficLog?: types.report.HttpTrafficEntry[],
    ): Promise<types.report.FailureAnalysis> {
        return this.failureClassifier.classify(
            errorMessage,
            scriptContent,
            relatedDocs,
            stepDescription,
            options,
            httpTrafficLog,
        );
    }

    public async promptForUserGoals(
        vectorCollectionName: string,
        files: DocFile[],
        maxGoals: number = 5,
        onProgress?: ProgressCallback,
        endpointInventory?: string,
        /** Changelog-drift steering block (rendered by renderChangelogSeed).
         *  Injected ONLY into goal generation — never the code-writing phase —
         *  so goals target breaking-change areas while code is still written
         *  from the OLD documentation. Empty string = no steering. */
        changelogSeed?: string,
    ): Promise<string[]> {
        this.logger.log(`Generating user goals using agentic loop...`);
        emitLog(onProgress, `Generating user goals using agentic loop...`);

        // 1. Router
        const goal =
            `Explore the project's documentation broadly and DEEPLY to identify up to ${maxGoals} ` +
            `demanding, multi-feature test scenarios. Actively seek the advanced / less-obvious ` +
            `surface (transactions, relations/joins, batch ops, advanced query options, ` +
            `configuration, hooks, error handling), not just the introductory examples.`;
        const plan = await this.promptForExecutionPlan(vectorCollectionName, goal, onProgress);
        const planStepsStr = plan.steps.map((s) => `- ${s.stepExplanation} (Action: ${s.action})`)
            .join("\n");

        // Coverage hint: when we have a known endpoint inventory, steer the research
        // agent toward thorough coverage rather than gravitating to popular endpoints.
        const inventoryHint = endpointInventory
            ? `\n\n## ENDPOINT INVENTORY\nThe API exposes the following endpoints/operations. Generate goals that exercise as many of these as possible and avoid duplicating coverage from goal to goal:\n${endpointInventory}`
            : "";

        // 2. Research / Exploration
        const systemPrompt = `You are a Research Agent gathering context for ${maxGoals} DEMANDING,
multi-feature user goals. Do not stop at the introductory "getting started" material — dig into
the advanced and less-obvious features (transactions, relations/joins/associations, batch or bulk
operations, advanced query/filter/pagination/aggregation options, configuration & option objects,
hooks/middleware, schema/migrations, error handling). For each candidate goal, collect enough
detail that it can chain several documented operations together, not a single call.
Follow this plan:
${planStepsStr}${inventoryHint}

When you have gathered enough advanced context, reply with EXACTLY "READY_FOR_GENERATION".`;

        const messages: import("@openai/openai").default.Chat.ChatCompletionMessageParam[] = [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Start your research.` },
        ];

        const toolHandlers = {
            search_knowledge_base: this.createSearchHandler(
                vectorCollectionName,
                "Agent searching",
                onProgress,
            ),
            ...this.vfsTools.createHandlers(files, onProgress),
        };

        const traceTracker = await this.createTraceTracker(
            "Goals Generation Phase",
            "Discover documentation goals",
        );

        const finalMessages = await runAgenticLoop(this.openai, this.logger, onProgress, {
            modelName: this.configService.values.openAI.modelName,
            messages,
            tools: [
                SEARCH_TOOL,
                LIST_FILES_TOOL,
                READ_FILE_TOOL,
                HEAD_FILE_TOOL,
                TAIL_FILE_TOOL,
                GREP_FILE_TOOL,
                GREP_CORPUS_TOOL,
                OUTLINE_FILE_TOOL,
                READ_SECTION_TOOL,
                GET_ENDPOINT_TOOL,
            ],
            toolHandlers,
            readySignal: "READY_FOR_GENERATION",
            maxIterations: this.configService.values.limits.maxResearchIterations,
            maxContextChars: this.configService.values.limits.maxContextChars,
            phaseLabel: "Goals Research",
            ...this.loopParams(),
            onTrace: traceTracker,
        });

        // 3. Generation Phase
        const agentSynthesis = finalMessages
            .filter((m) => m.role === "assistant" && typeof m.content === "string" && m.content)
            .map((m) => m.content as string)
            .join("\n\n");

        const toolResults = finalMessages
            .filter((m) => m.role === "tool")
            .map((m) => typeof m.content === "string" ? m.content : "")
            .join("\n\n");

        const contextFound = (agentSynthesis + "\n\n" + toolResults).substring(
            0,
            this.configService.values.limits.maxContextChars,
        );

        try {
            const parsed = await this.structured(
                templates.PLANNER_GOALS_SYSTEM_PROMPT,
                templates.createPlannerGoalsUserPrompt(contextFound, maxGoals) +
                    (changelogSeed ?? ""),
                schemas.GoalsSchema,
            );
            if (!parsed.goals || parsed.goals.length === 0) {
                throw new Error("the model returned an empty goal list");
            }
            return parsed.goals.slice(0, maxGoals);
        } catch (error) {
            // FAIL LOUDLY. Returning a placeholder goal here used to let a run
            // continue as if healthy: the undici target produced a single generic
            // "Explore API documentation…" goal, scored 1/1, and looked like a
            // valid result in the summary table while measuring nothing. A run
            // without real goals is worthless, so abort and surface the cause —
            // the caller marks the target failed and keeps its checkpoint.
            const reason = (error as Error)?.message ?? String(error);
            this.logger.error(error, "Goal generation FAILED — aborting run");
            emitLog(onProgress, `Goal generation FAILED: ${reason}`);
            throw new Error(
                `Goal generation failed: ${reason}. The run is aborted rather than ` +
                    `continuing with a placeholder goal, which would silently produce ` +
                    `meaningless results.`,
            );
        }
    }

    public async promptForMasterSummary(
        reportsData: any,
        gapClusters?: unknown[],
        _onProgress?: ProgressCallback,
    ): Promise<{ structured: types.planner.StructuredMasterSummary; markdown: string }> {
        this.logger.log(`Generating master summary report...`);

        try {
            const structured = await this.structured(
                templates.PLANNER_SUMMARY_SYSTEM_PROMPT,
                templates.createPlannerSummaryUserPrompt(
                    JSON.stringify(reportsData, null, 2),
                    gapClusters ? JSON.stringify(gapClusters, null, 2) : undefined,
                ),
                schemas.MasterSummarySchema,
            ) as unknown as types.planner.StructuredMasterSummary;

            // Build a fallback markdown from the structured data
            const markdown = structured.executiveSummary || "See structured summary for details.";

            return { structured, markdown };
        } catch (error) {
            this.logger.error(error, "Failed to generate master summary report");
            return {
                structured: {
                    executiveSummary: "Failed to generate summary.",
                    overallPassRate: 0,
                    failureTaxonomy: {},
                    topFailingFunctions: [],
                    goalsBreakdown: [],
                    documentationGapDetails: [],
                    recommendations: [],
                },
                markdown: "Failed to generate summary report.",
            };
        }
    }

    /**
     * #21 — Extract structured gap-analysis prose from a NEEDS_RESEARCH bounce.
     *
     * When the verification agent writes text like "The documentation doesn't describe
     * the auth header format …\nNEEDS_RESEARCH: auth header", the content before the
     * NEEDS_RESEARCH: line is its self-reported diagnostic. Extracting it gives the
     * friction event a human-readable note that carries the agent's gap insight even
     * when the run ultimately succeeds.
     */
    private extractGapAnalysisFromBounce(content: string): string | undefined {
        const idx = content.indexOf("NEEDS_RESEARCH:");
        if (idx <= 0) return undefined;
        const before = content.slice(0, idx).trim();
        if (before.length < 20) return undefined;
        // Take the last 3 paragraphs of the pre-bounce text — that's where the
        // diagnostic is most likely to sit.
        const paragraphs = before.split(/\n{2,}/).filter((p) => p.trim().length > 0);
        return paragraphs.slice(-3).join("\n\n").slice(0, 800);
    }

    private async createTraceTracker(phase: string, goal?: string, testSuiteId?: string) {
        const trace = await this.traceRepository.create({
            id: crypto.randomUUID() as any,
            phase,
            goal,
            testSuiteId,
            events: [],
        });

        return async (event: import("../types/index.ts").trace.TraceEvent) => {
            await this.traceRepository.addEvent(trace.id, event);
        };
    }
}
