import OpenAI from "@openai/openai";
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
    SearchToolArgs,
    SmokeTestCallback,
    SmokeTestToolArgs,
    StructuredResponse,
} from "./prompt/types.ts";
import * as templates from "./prompt/templates.ts";
import { runAgenticLoop } from "./prompt/agenticLoop.ts";
import { LlmComplete, rerankResults } from "../rag/Reranker.ts";
import { z } from "zod";
import { chatStructured, coerceJson } from "../llm/StructuredLlm.ts";
import * as schemas from "../llm/schemas.ts";
import { majorityVote } from "../eval/metrics.ts";

export type { CodeGenerationResponse, PromptOptions, StructuredResponse } from "./prompt/types.ts";

export class PromptService {
    constructor(
        private openai: OpenAI,
        private logger: Logger,
        private embeddingService: EmbeddingService,
        private vectorCollectionFactory: VectorCollectionFactory,
        private configService: ConfigService,
        private traceRepository: TraceRepository,
    ) {}

    /** Common deterministic generation params (temperature/seed) for raw chat calls. */
    private llmParams(): Record<string, unknown> {
        const llm = this.configService.values.llm;
        return {
            temperature: llm.temperature,
            ...(llm.seed !== undefined ? { seed: llm.seed } : {}),
        };
    }

    /**
     * Extra knobs for the agentic loop config (NOT for raw create() calls — these
     * would be invalid OpenAI body params). Includes determinism + retry + token budget.
     */
    private loopParams(): Record<string, unknown> {
        const llm = this.configService.values.llm;
        return {
            temperature: llm.temperature,
            ...(llm.seed !== undefined ? { seed: llm.seed } : {}),
            maxRetries: llm.maxRetries,
            retryBaseMs: llm.retryBaseMs,
            callTimeoutMs: llm.callTimeoutMs,
            maxContextTokens: this.configService.values.limits.maxContextTokens,
        };
    }

    /** Request a JSON object from the model and validate it against a zod schema. */
    private structured<T>(system: string, user: string, schema: z.ZodType<T>): Promise<T> {
        const llm = this.configService.values.llm;
        return chatStructured<T>({
            openai: this.openai,
            model: this.configService.values.openAI.modelName,
            system,
            user,
            schema,
            mode: llm.structuredOutputMode,
            temperature: llm.temperature,
            seed: llm.seed,
            maxRepairAttempts: llm.maxRepairAttempts,
            maxRetries: llm.maxRetries,
            retryBaseMs: llm.retryBaseMs,
            logger: this.logger,
        });
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
            search_knowledge_base: async (_id: string, rawArgs: any) => {
                const args = rawArgs as SearchToolArgs;
                emitLog(onProgress, `Agent searching: "${args.query}"`);
                const results = await this.performRAGSearch(
                    vectorCollectionName,
                    args.query,
                    this.configService.values.limits.defaultSearchLimit,
                );
                const truncated = results.map((r) => ({
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
                }));
                return JSON.stringify(truncated);
            },
            ...this.createVfsToolHandlers(files, onProgress),
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

        const initialSearchResults = await this.performRAGSearch(
            vectorCollectionName,
            userGoal,
            this.configService.values.limits.defaultSearchLimit,
        );
        const initialDocsContent = this.formatSearchResults(initialSearchResults);

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

        let { initialDocsContent, contextFound, messages: researchMessages } = await this
            .runResearchPhase(
                vectorCollectionName,
                userGoal,
                files,
                onProgress,
            );

        // The research agent's explicit COVERED / NEEDS RESEARCH gap analysis is
        // documentation feedback in its own right — extract and persist it.
        const coverageReport = await this.extractCoverageReport(researchMessages);

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
            );

            const lastMessage = verificationMessages[verificationMessages.length - 1];
            const content = lastMessage.content;

            if (typeof content === "string" && content.includes("NEEDS_RESEARCH:")) {
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

                    const additionalDocs = await this.performRAGSearch(
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

        const response = await this.runGenerationPhase(verificationMessages, onProgress);
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
        const initialSearchResults = await this.performRAGSearch(
            vectorCollectionName,
            userGoal,
            this.configService.values.limits.defaultSearchLimit,
        );
        const initialDocsContent = this.formatSearchResults(initialSearchResults);

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
                search_knowledge_base: async (_id, rawArgs) => {
                    const args = rawArgs as SearchToolArgs;
                    emitLog(onProgress, `Agent RAG searching knowledge base for: "${args.query}"`);
                    const results = await this.performRAGSearch(
                        vectorCollectionName,
                        args.query,
                        this.configService.values.limits.defaultSearchLimit,
                    );
                    const truncated = results.map((r) => ({
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
                    }));
                    return JSON.stringify(truncated);
                },
                ...this.createVfsToolHandlers(files, onProgress),
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
    ): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
        // Smartly prune documentation before verification to stay within token budget
        const query = userGoal.substring(0, 2000);
        const maxDocsChars = this.configService.values.limits.maxScenarioDocsChars;

        const combinedRaw =
            `#### Initial Documentation:\n${initialDocsContent}\n\n#### Researched Documentation:\n${contextFound}`;
        const smartDocs = await this.rankAndFilterDocs(combinedRaw, query, maxDocsChars);

        this.logger.log(`Agentic RAG Verification Phase (Smoke Testing)...`);
        emitLog(onProgress, `Agentic RAG Verification Phase... Smoke testing examples in Docker.`);

        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: "system", content: templates.VERIFICATION_SYSTEM_PROMPT },
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
                search_knowledge_base: async (_id, rawArgs) => {
                    const args = rawArgs as SearchToolArgs;
                    emitLog(
                        onProgress,
                        `Agent RAG searching knowledge base (Verification phase) for: "${args.query}"`,
                    );
                    const results = await this.performRAGSearch(
                        vectorCollectionName,
                        args.query,
                        this.configService.values.limits.defaultSearchLimit,
                    );
                    const truncated = results.map((r) => ({
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
                    }));
                    return JSON.stringify(truncated);
                },
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
                { role: "system", content: templates.GENERATION_SYSTEM_PROMPT },
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
            templates.GENERATION_SYSTEM_PROMPT,
            genUserPrompt,
            schemas.CodeGenerationSchema,
        ) as CodeGenerationResponse;
    }

    private formatSearchResults(
        results: types.vector.SearchResult<types.file.FileShard>[],
    ): string {
        return results
            .map((res, i) =>
                `--- DOCUMENT ${i + 1} (Score: ${res.score}) ---\n${
                    (res.payload?.content || "No content").substring(
                        0,
                        this.configService.values.limits.maxResultChars,
                    )
                }\n`
            )
            .join("\n");
    }

    /** Shared chat closure used by the reranker; honours determinism config. */
    private buildLlmComplete(): LlmComplete {
        return async (system, user) => {
            const llm = this.configService.values.llm;
            const resp = await this.openai.chat.completions.create({
                model: this.configService.values.openAI.modelName,
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
                temperature: llm.temperature,
                ...(llm.seed !== undefined ? { seed: llm.seed } : {}),
            } as any);
            return resp.choices[0]?.message?.content || "";
        };
    }

    /** Rerank hybrid-retrieval results (no-op unless `reranker.mode` is set). */
    public async rerankSearchResults(
        query: string,
        results: types.vector.SearchResult<types.file.FileShard>[],
        limit: number,
    ): Promise<types.vector.SearchResult<types.file.FileShard>[]> {
        const cfg = this.configService.values.reranker;
        if (cfg.mode === "off") return results.slice(0, limit);
        return await rerankResults(
            query,
            results,
            limit,
            (r) => r.payload?.content || "",
            cfg,
            {
                llmComplete: cfg.mode === "llm" ? this.buildLlmComplete() : undefined,
                logger: this.logger,
            },
        );
    }

    private async performRAGSearch(
        collectionName: string,
        query: string,
        limit: number = this.configService.values.limits.defaultSearchLimit,
    ): Promise<types.vector.SearchResult<types.file.FileShard>[]> {
        try {
            this.logger.log(
                `RAG search — collection: "${collectionName}" query: "${query.slice(0, 120)}"`,
            );
            const collection = await this.vectorCollectionFactory.createCollection<
                types.file.FileShard
            >(collectionName);

            const dense = await this.embeddingService.embed(query);
            const sparse = this.embeddingService.sparseEmbed(query);

            // When reranking is enabled, over-fetch then let the reranker cut to `limit`.
            const rerankCfg = this.configService.values.reranker;
            const fetchLimit = rerankCfg.mode === "off" ? limit : Math.max(limit, rerankCfg.topN);

            const raw = await collection.searchHybrid(
                dense[0] as types.vector.DenseVector,
                sparse,
                fetchLimit,
            );
            return await this.rerankSearchResults(query, raw, limit);
        } catch (error) {
            const err = error as types.vector.QdrantError;
            const errorData = err?.data?.status?.error || err?.message || String(error);
            this.logger.error(
                `RAG search failed for collection "${collectionName}": ${
                    JSON.stringify(errorData).substring(0, 300)
                }`,
            );
            return [];
        }
    }

    public async refineSearchQuery(
        error: string,
        context: string,
    ): Promise<string> {
        const prompt = templates.createRefineSearchQueryPrompt(error, context);

        try {
            const response = await this.openai.chat.completions.create({
                model: this.configService.values.openAI.modelName,
                messages: [{ role: "user", content: prompt }],
                ...this.llmParams(),
            } as any);

            return response.choices[0]?.message?.content?.trim() ||
                `${error} ${context}`.substring(0, 500);
        } catch (err) {
            this.logger.error(err, "Failed to refine search query");
            return `${error} ${context}`.substring(0, 500);
        }
    }

    public async classifyFailure(
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
        // Format captured HTTP traffic as a concise classifier input section.
        const httpSection = httpTrafficLog && httpTrafficLog.length > 0
            ? `\n\n### HTTP TRAFFIC DURING EXECUTION\n` +
                httpTrafficLog.slice(0, 20).map((e) =>
                    `${e.method} ${e.url} → ${e.responseStatus ?? e.error ?? "no response"}` +
                    (e.responseBody ? `\n  Response: ${e.responseBody.slice(0, 300)}` : "")
                ).join("\n")
            : "";

        const system =
            `You are a Documentation Quality Analyst. A code example that was written based on library documentation has CRASHED. Your job is to classify WHY it failed by comparing the error to the documentation.`;
        const user = `### THE ERROR
${errorMessage}

### THE CODE THAT CRASHED
${scriptContent}

### DOCUMENTATION CONTEXT
(Fragments retrieved for this error, plus — when available — the documentation the code
generator actually used. Quote pinpointed fragments VERBATIM from this context, never from memory.)
${relatedDocs || "No related documentation was found."}${httpSection}

### WHAT THE CODE WAS TRYING TO DO
${stepDescription}

### YOUR TASK
Determine:
1. Which function/method call caused the crash
2. Classify the documentationGap as exactly one of:
   - MISSING (no docs exist for this function)
   - AMBIGUOUS (docs exist but are unclear/confusing)
   - INCORRECT (docs say one thing but the library does another)
   - CONFIG (library needs configuration/setup that the docs omit)
   - ENVIRONMENT (the failure is a tooling/runtime problem — missing dependency, install failure, sandbox limit — NOT a documentation problem)
   - UNKNOWN (cannot determine)
3. Your reasoning
4. A concrete suggestion for how the documentation should be fixed
5. PINPOINTED FRAGMENT: Quote the RELEVANT SECTION from the documentation — NOT just a heading or anchor line.
   The fragment MUST include ALL of the following that are present in the docs:
     a) The endpoint/function heading and its description (1-3 sentences)
     b) All parameters or request body fields (name, type, required/optional, meaning)
     c) The return value / response schema description
     d) At least one code example if the docs provide one
   Format: "[filename]: <multi-line verbatim quote>"
   Minimum length: the fragment should be at least 5 meaningful lines unless the docs genuinely have less.
   WRONG ✗: "[api.md]: ## Create a repository"
   RIGHT ✓: "[api.md]: ## Create a repository\\nCreate a new repository for the specified user.\\n\\n**Parameters**\\n- 'owner' (string, required): ...\\n- 'name' (string, required): ..."
6. PROPOSED FRAGMENT: A corrected/improved version of that documentation section (same multi-line format).

Respond with a JSON object:
{
    "errorMessage": "the key error line",
    "failedFunction": "the function/method that crashed",
    "documentationGap": "MISSING | AMBIGUOUS | INCORRECT | CONFIG | ENVIRONMENT | UNKNOWN",
    "reasoning": "why you classified it this way",
    "suggestedDocsFix": "concrete suggestion for documentation improvement",
    "pinpointedFragment": "exact multi-line quote from the docs (minimum 5 lines)",
    "proposedFragment": "corrected multi-line version of the documentation section"
}`;

        const votes = this.configService.values.classifier.votes;
        // Fire all votes concurrently — they are fully independent LLM calls.
        const settled = await Promise.allSettled(
            Array.from(
                { length: votes },
                (_, i) =>
                    this.structured(system, user, schemas.FailureAnalysisSchema)
                        .catch((err) => {
                            this.logger.error(err, `Failed to classify failure (vote ${i + 1})`);
                            return null;
                        }),
            ),
        );
        const candidates: types.report.FailureAnalysis[] = settled
            .map((r) => (r.status === "fulfilled" ? r.value : null))
            .filter((v): v is types.report.FailureAnalysis => v !== null);

        if (candidates.length === 0) {
            return {
                errorMessage: errorMessage.substring(0, 200),
                failedFunction: "unknown",
                documentationGap: "UNKNOWN",
                reasoning: "Classification failed due to LLM error",
                suggestedDocsFix: "Manual review required",
                confidence: 0,
                votes: 0,
            };
        }

        // Self-consistency: majority vote on the category; among candidates that
        // agree with the winner, prefer the one whose pinpointed fragment best
        // verifies against the actual documentation corpus.
        const winningGap = majorityVote(candidates.map((c) => c.documentationGap));
        const winners = candidates.filter((c) => c.documentationGap === winningGap);
        const scorer = options.fragmentScorer;
        const representative = scorer
            ? [...winners].sort(
                (a, b) => scorer(b.pinpointedFragment) - scorer(a.pinpointedFragment),
            )[0]
            : winners[0];

        return {
            ...(representative ?? candidates[0]),
            confidence: Math.round((winners.length / candidates.length) * 1000) / 1000,
            votes: candidates.length,
        };
    }

    private async rankAndFilterDocs(
        content: string,
        query: string,
        maxChars: number,
    ): Promise<string> {
        if (content.length <= maxChars) return content;

        // Split by document markers (formatSearchResults emits
        // "--- DOCUMENT N (Score: x) ---", so match the trailing metadata too).
        const chunks = content.split(/--- DOCUMENT \d+[^\n]*---/).filter((c) =>
            c.trim().length > 0
        );
        if (chunks.length <= 1) {
            // If no markers, fallback to double newlines
            const fallbackChunks = content.split("\n\n").filter((c) => c.trim().length > 0);
            if (fallbackChunks.length > 1) {
                return this.rankAndFilterDocsByChunks(fallbackChunks, query, maxChars);
            }
            return content.substring(0, maxChars);
        }

        return this.rankAndFilterDocsByChunks(chunks, query, maxChars);
    }

    private async rankAndFilterDocsByChunks(
        chunks: string[],
        query: string,
        maxChars: number,
    ): Promise<string> {
        try {
            // Single batched embeddings request for the query + all chunks.
            const inputs = [query, ...chunks.map((c) => c.substring(0, 3000))];
            const vectors = await this.embeddingService.embedBatch(inputs);
            const queryVector = vectors[0];

            const scoredChunks = chunks.map((content, i) => ({
                content,
                score: this.cosineSimilarity(queryVector, vectors[i + 1] as number[]),
            }));

            scoredChunks.sort((a, b) => b.score - a.score);

            // Greedy best-first packing: iterate by descending score, include each
            // chunk that still fits. Stop once the budget is fully consumed — later
            // chunks are lower-relevance and skipping them would wrongly admit them.
            let result = "";
            for (const sc of scoredChunks) {
                if ((result.length + sc.content.length) > maxChars) break;
                result += (result ? "\n\n" : "") + sc.content;
            }

            return result || chunks[0].substring(0, maxChars);
        } catch (error) {
            this.logger.error(error, "Error in smart truncation");
            return chunks.join("\n\n").substring(0, maxChars);
        }
    }

    private cosineSimilarity(vecA: number[], vecB: number[]): number {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    public async promptForUserGoals(
        vectorCollectionName: string,
        files: DocFile[],
        maxGoals: number = 5,
        onProgress?: ProgressCallback,
        endpointInventory?: string,
    ): Promise<string[]> {
        this.logger.log(`Generating user goals using agentic loop...`);
        emitLog(onProgress, `Generating user goals using agentic loop...`);

        // 1. Router
        const goal =
            `Explore the project and identify up to ${maxGoals} primary user goals or test scenarios for this API/library.`;
        const plan = await this.promptForExecutionPlan(vectorCollectionName, goal, onProgress);
        const planStepsStr = plan.steps.map((s) => `- ${s.stepExplanation} (Action: ${s.action})`)
            .join("\n");

        // Coverage hint: when we have a known endpoint inventory, steer the research
        // agent toward thorough coverage rather than gravitating to popular endpoints.
        const inventoryHint = endpointInventory
            ? `\n\n## ENDPOINT INVENTORY\nThe API exposes the following endpoints/operations. Generate goals that exercise as many of these as possible and avoid duplicating coverage from goal to goal:\n${endpointInventory}`
            : "";

        // 2. Research / Exploration
        const systemPrompt = `You are a Research Agent finding user goals.
Your goal is to gather enough context to suggest ${maxGoals} distinct user goals.
Follow this plan:
${planStepsStr}${inventoryHint}

When you have enough context, reply with EXACTLY "READY_FOR_GENERATION".`;

        const messages: import("@openai/openai").default.Chat.ChatCompletionMessageParam[] = [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Start your research.` },
        ];

        const toolHandlers = {
            search_knowledge_base: async (_id: string, rawArgs: any) => {
                const args = rawArgs as SearchToolArgs;
                emitLog(onProgress, `Agent searching: "${args.query}"`);
                const results = await this.performRAGSearch(
                    vectorCollectionName,
                    args.query,
                    this.configService.values.limits.defaultSearchLimit,
                );
                const truncated = results.map((r) => ({
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
                }));
                return JSON.stringify(truncated);
            },
            ...this.createVfsToolHandlers(files, onProgress),
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
                templates.createPlannerGoalsUserPrompt(contextFound, maxGoals),
                schemas.GoalsSchema,
            );
            return parsed.goals.slice(0, maxGoals);
        } catch (error) {
            this.logger.error(error, "Failed to parse user goals from LLM");
            return ["Explore API documentation and verify endpoints."];
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

    private createVfsToolHandlers(files: DocFile[], onProgress?: ProgressCallback) {
        // Pre-build a parsed OpenAPI index for get_endpoint lookups.
        const openApiIndex = this.buildOpenApiIndex(files);

        return {
            list_files: async () => {
                emitLog(onProgress, "Agent listing VFS files.");
                return files.map((f) => f.metadata.filename).join("\n") || "No files available.";
            },
            read_file: async (_id: string, args: any) => {
                emitLog(onProgress, `Agent reading file: ${args.filename}`);
                const file = files.find((f) => f.metadata.filename === args.filename);
                if (!file) return `File not found: ${args.filename}`;
                const content = new TextDecoder().decode(file.buffer);
                // Cap whole-file reads: a large doc can be 200k+ tokens and would
                // blow the model context in a single tool result. Return a head
                // slice and steer the agent toward targeted tools for the rest.
                const cap = this.configService.values.limits.maxFileReadChars;
                if (content.length > cap) {
                    const totalLines = content.split("\n").length;
                    return content.slice(0, cap) +
                        `\n\n…[truncated: showing first ${cap} of ${content.length} chars, ` +
                        `${totalLines} lines total]…\n` +
                        `This file is large. Use outline_file() to see its structure, ` +
                        `read_section(heading) to read a specific section, ` +
                        `grep_corpus(pattern) for cross-file search, ` +
                        `or search_knowledge_base(query) for semantic lookup.`;
                }
                return content;
            },
            head_file: async (_id: string, args: any) => {
                const linesCount = args.lines || 50;
                emitLog(
                    onProgress,
                    `Agent reading head of file: ${args.filename} (${linesCount} lines)`,
                );
                const file = files.find((f) => f.metadata.filename === args.filename);
                if (!file) return `File not found: ${args.filename}`;
                const content = new TextDecoder().decode(file.buffer);
                return content.split("\n").slice(0, linesCount).join("\n");
            },
            tail_file: async (_id: string, args: any) => {
                const linesCount = args.lines || 50;
                emitLog(
                    onProgress,
                    `Agent reading tail of file: ${args.filename} (${linesCount} lines)`,
                );
                const file = files.find((f) => f.metadata.filename === args.filename);
                if (!file) return `File not found: ${args.filename}`;
                const content = new TextDecoder().decode(file.buffer);
                const lines = content.split("\n");
                return lines.slice(Math.max(0, lines.length - linesCount)).join("\n");
            },
            grep_file: async (_id: string, args: any) => {
                emitLog(
                    onProgress,
                    `Agent grepping file: ${args.filename} for pattern: ${args.pattern}`,
                );
                const file = files.find((f) => f.metadata.filename === args.filename);
                if (!file) return `File not found: ${args.filename}`;
                const content = new TextDecoder().decode(file.buffer);
                const lines = content.split("\n");
                let result = "";
                let regex: RegExp;
                try {
                    regex = new RegExp(args.pattern, "i");
                } catch {
                    return `Invalid regex pattern: ${args.pattern}`;
                }
                for (let i = 0; i < lines.length; i++) {
                    if (regex.test(lines[i])) {
                        result += `[Line ${i + 1}]: ${lines[i]}\n`;
                    }
                }
                return result || `No matches found for ${args.pattern} in ${args.filename}`;
            },

            // ── New VFS tools ─────────────────────────────────────────────────

            grep_corpus: async (_id: string, args: any) => {
                const pattern = args.pattern as string;
                const contextLines = Math.min(Number(args.context_lines) || 2, 10);
                emitLog(onProgress, `Agent grepping corpus for: ${pattern}`);
                let regex: RegExp;
                try {
                    regex = new RegExp(pattern, "i");
                } catch {
                    return `Invalid regex pattern: ${pattern}`;
                }
                const results: string[] = [];
                for (const f of files) {
                    const content = new TextDecoder().decode(f.buffer);
                    const lines = content.split("\n");
                    for (let i = 0; i < lines.length; i++) {
                        if (regex.test(lines[i])) {
                            const from = Math.max(0, i - contextLines);
                            const to = Math.min(lines.length - 1, i + contextLines);
                            results.push(`[${f.metadata.filename}:${i + 1}]`);
                            for (let j = from; j <= to; j++) {
                                results.push(`${j === i ? ">" : " "} ${j + 1}: ${lines[j]}`);
                            }
                            results.push("");
                            if (results.length > 500) {
                                results.push("…[truncated — too many matches]");
                                break;
                            }
                        }
                    }
                    if (results.length > 500) break;
                }
                return results.join("\n") || `No matches for pattern: ${pattern}`;
            },

            outline_file: async (_id: string, args: any) => {
                emitLog(onProgress, `Agent outlining file: ${args.filename}`);
                const file = files.find((f) => f.metadata.filename === args.filename);
                if (!file) return `File not found: ${args.filename}`;
                const content = new TextDecoder().decode(file.buffer);

                // OpenAPI JSON: list paths + methods
                if (
                    args.filename.endsWith(".json") || args.filename.endsWith(".yaml") ||
                    args.filename.endsWith(".yml")
                ) {
                    if (openApiIndex.has(args.filename)) {
                        const endpoints = openApiIndex.get(args.filename)!;
                        return `OpenAPI spec — ${endpoints.length} endpoints:\n` +
                            endpoints.map((e) =>
                                `  ${e.method.toUpperCase()} ${e.path}${
                                    e.summary ? ` — ${e.summary}` : ""
                                }`
                            ).join("\n");
                    }
                }

                // Markdown: headings with line numbers
                const lines = content.split("\n");
                const headings: string[] = [];
                for (let i = 0; i < lines.length; i++) {
                    const m = lines[i].match(/^(#{1,6})\s+(.*)/);
                    if (m) {
                        headings.push(`L${i + 1} ${"  ".repeat(m[1].length - 1)}${m[1]} ${m[2]}`);
                    }
                }
                return headings.length > 0
                    ? headings.join("\n")
                    : `No headings found in ${args.filename}. File has ${lines.length} lines.`;
            },

            read_section: async (_id: string, args: any) => {
                const heading = String(args.heading || "").toLowerCase();
                emitLog(
                    onProgress,
                    `Agent reading section "${args.heading}" from ${args.filename}`,
                );
                const file = files.find((f) => f.metadata.filename === args.filename);
                if (!file) return `File not found: ${args.filename}`;
                const content = new TextDecoder().decode(file.buffer);
                const lines = content.split("\n");

                // Find the first heading that matches (case-insensitive partial match).
                let startIdx = -1;
                let headingLevel = 0;
                for (let i = 0; i < lines.length; i++) {
                    const m = lines[i].match(/^(#{1,6})\s+(.*)/);
                    if (m && m[2].toLowerCase().includes(heading)) {
                        startIdx = i;
                        headingLevel = m[1].length;
                        break;
                    }
                }
                if (startIdx === -1) {
                    return `No heading matching "${args.heading}" found in ${args.filename}.`;
                }

                // Collect lines until the next heading of same or higher level.
                const section: string[] = [lines[startIdx]];
                for (let i = startIdx + 1; i < lines.length; i++) {
                    const m = lines[i].match(/^(#{1,6})\s+/);
                    if (m && m[1].length <= headingLevel) break;
                    section.push(lines[i]);
                }
                const result = section.join("\n");
                const cap = this.configService.values.limits.maxFileReadChars;
                return result.length > cap
                    ? result.slice(0, cap) + `\n…[section truncated at ${cap} chars]`
                    : result;
            },

            get_endpoint: async (_id: string, args: any) => {
                const targetPath = String(args.path || "").toLowerCase();
                const targetMethod = args.method ? String(args.method).toUpperCase() : null;
                emitLog(
                    onProgress,
                    `Agent looking up endpoint: ${targetMethod || "*"} ${args.path}`,
                );

                const hits: string[] = [];
                for (const [filename, endpoints] of openApiIndex) {
                    for (const ep of endpoints) {
                        if (!ep.path.toLowerCase().includes(targetPath)) continue;
                        if (targetMethod && ep.method.toUpperCase() !== targetMethod) continue;
                        hits.push(
                            `**${ep.method.toUpperCase()} ${ep.path}** (${filename})` +
                                (ep.summary ? `\n${ep.summary}` : "") +
                                "\n```json\n" +
                                JSON.stringify(ep.definition, null, 2).slice(0, 2000) + "\n```",
                        );
                    }
                }
                return hits.length > 0
                    ? hits.join("\n\n---\n\n")
                    : `No endpoint matching "${
                        args.method ?? "*"
                    } ${args.path}" found in OpenAPI specs.`;
            },
        };
    }

    // Memoize by array reference: the same `files` array is passed to every
    // createVfsToolHandlers call within a single request, so parsing happens once.
    private readonly openApiIndexCache = new WeakMap<
        object[],
        Map<string, Array<{ method: string; path: string; summary?: string; definition: unknown }>>
    >();

    /** Build a path→endpoints index from all OpenAPI JSON files in the project. */
    private buildOpenApiIndex(
        files: DocFile[],
    ): Map<string, Array<{ method: string; path: string; summary?: string; definition: unknown }>> {
        const cached = this.openApiIndexCache.get(files);
        if (cached) return cached;
        const index = new Map<
            string,
            Array<{ method: string; path: string; summary?: string; definition: unknown }>
        >();
        for (const file of files) {
            const fn: string = file.metadata.filename;
            if (!fn.endsWith(".json") && !fn.endsWith(".yaml") && !fn.endsWith(".yml")) continue;
            try {
                const content = new TextDecoder().decode(file.buffer);
                if (!content.includes('"paths"') && !content.includes("paths:")) continue;
                const obj = JSON.parse(content) as Record<string, unknown>;
                if (typeof obj !== "object" || !obj.paths) continue;
                const endpoints: Array<
                    { method: string; path: string; summary?: string; definition: unknown }
                > = [];
                for (
                    const [apiPath, methods] of Object.entries(
                        obj.paths as Record<string, Record<string, unknown>>,
                    )
                ) {
                    for (const [method, def] of Object.entries(methods)) {
                        if (["parameters", "summary", "description"].includes(method)) continue;
                        const d = def as Record<string, unknown>;
                        endpoints.push({
                            method,
                            path: apiPath,
                            summary: d?.summary as string | undefined,
                            definition: def,
                        });
                    }
                }
                if (endpoints.length > 0) index.set(fn, endpoints);
            } catch { /* not valid JSON/OpenAPI */ }
        }
        this.openApiIndexCache.set(files, index);
        return index;
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
