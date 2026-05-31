import OpenAI from "@openai/openai";
import { Logger } from "../Logger.ts";
import { EmbeddingService } from "./EmbeddingService.ts";
import { VectorCollectionFactory } from "../db/vectordb/VectorCollectionFactory.ts";
import * as types from "../types/index.ts";
import { ConfigService } from "./ConfigService.ts";
import { TraceRepository } from "../db/mongo/TraceRepository.ts";
import {
    SEARCH_TOOL,
    SMOKE_TEST_TOOL,
    LIST_FILES_TOOL,
    READ_FILE_TOOL,
    HEAD_FILE_TOOL,
    TAIL_FILE_TOOL,
    GREP_FILE_TOOL,
} from "./prompt/constants.ts";
import { emitLog, emitToken, ProgressCallback } from "./prompt/helpers.ts";
import {
    CodeGenerationResponse,
    PromptOptions,
    SearchToolArgs,
    SmokeTestCallback,
    SmokeTestToolArgs,
    StructuredResponse,
    RouterPlanResponse,
} from "./prompt/types.ts";
import * as templates from "./prompt/templates.ts";
import { runAgenticLoop } from "./prompt/agenticLoop.ts";
import { LlmComplete, rerankResults } from "../rag/Reranker.ts";
import { z } from "zod";
import { chatStructured, coerceJson } from "../llm/StructuredLlm.ts";
import * as schemas from "../llm/schemas.ts";

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
        return { temperature: llm.temperature, ...(llm.seed !== undefined ? { seed: llm.seed } : {}) };
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
        files: { metadata: any; buffer: Uint8Array }[],
        startingContext: string,
        options: PromptOptions = {},
        onProgress?: ProgressCallback,
    ): Promise<StructuredResponse> {
        const goal = `Generate a comprehensive test scenario. Preferences: ${options.userPreferences || "None"}. Steps: ${options.minimalLength || 10}-${options.maximalLength || 20}.`;
        
        // 1. Router
        const plan = await this.promptForExecutionPlan(vectorCollectionName, goal, onProgress);
        const planStepsStr = plan.steps.map(s => `- ${s.stepExplanation} (Action: ${s.action})`).join("\n");

        // 2. Research / Exploration using agentic loop
        const systemPrompt = `You are a Research Agent planning a test scenario. 
Your goal is to gather the exact API functions and context needed.
Follow this plan:
${planStepsStr}

When you have found all necessary functions and endpoints, reply with EXACTLY "READY_FOR_GENERATION".`;

        const messages: import("@openai/openai").default.Chat.ChatCompletionMessageParam[] = [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Start your research to generate a ${options.minimalLength || 10}-${options.maximalLength || 20} steps scenario.` }
        ];

        const toolHandlers = {
            search_knowledge_base: async (_id: string, rawArgs: any) => {
                const args = rawArgs as SearchToolArgs;
                emitLog(onProgress, `Agent searching: "${args.query}"`);
                const results = await this.performRAGSearch(vectorCollectionName, args.query, this.configService.values.limits.defaultSearchLimit);
                const truncated = results.map((r) => ({ ...r, payload: r.payload ? { ...r.payload, content: (r.payload.content || "").substring(0, this.configService.values.limits.maxResultChars) } : r.payload }));
                return JSON.stringify(truncated);
            },
            ...this.createVfsToolHandlers(files, onProgress)
        };

        const traceTracker = await this.createTraceTracker("Research Phase", goal);

        const finalMessages = await runAgenticLoop(this.openai, this.logger, onProgress, {
            modelName: this.configService.values.openAI.modelName,
            messages,
            tools: [SEARCH_TOOL, LIST_FILES_TOOL, READ_FILE_TOOL, HEAD_FILE_TOOL, TAIL_FILE_TOOL, GREP_FILE_TOOL],
            toolHandlers,
            readySignal: "READY_FOR_GENERATION",
            maxIterations: this.configService.values.limits.maxResearchIterations,
            maxContextChars: this.configService.values.limits.maxContextChars,
            phaseLabel: "Scenario Research",
            ...this.loopParams(),
            onTrace: traceTracker
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

        const contextFound = (agentSynthesis + "\n\n" + toolResults).substring(0, this.configService.values.limits.maxContextChars);

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
        onProgress?: ProgressCallback,
        smokeTestCallback?: SmokeTestCallback,
    ): Promise<{ response: CodeGenerationResponse; history: any[] }> {
        this.logger.log(`Starting Agentic RAG for goal: "${userGoal}"`);
        emitLog(onProgress, `Starting Agentic RAG for goal: "${userGoal}"`);

        let { initialDocsContent, contextFound, messages: researchMessages } = await this.runResearchPhase(
            vectorCollectionName,
            userGoal,
            onProgress,
        );

        let verificationMessages: import("@openai/openai").default.Chat.ChatCompletionMessageParam[] = [];
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
            );

            const lastMessage = verificationMessages[verificationMessages.length - 1];
            const content = lastMessage.content;
            
            if (typeof content === "string" && content.includes("NEEDS_RESEARCH:")) {
                const queryMatch = content.match(/NEEDS_RESEARCH:\s*(.*)/);
                if (queryMatch && queryMatch[1]) {
                    const query = queryMatch[1].trim();
                    this.logger.log(`Verification agent requested more research: "${query}"`);
                    emitLog(onProgress, `Verification agent requested more research: "${query}"`);
                    
                    const additionalDocs = await this.performRAGSearch(
                        vectorCollectionName, 
                        query, 
                        this.configService.values.limits.defaultSearchLimit
                    );
                    const formattedAdditionalDocs = JSON.stringify(additionalDocs.map(r => ({
                        ...r,
                        payload: r.payload ? {
                            ...r.payload,
                            content: (r.payload.content || "").substring(0, this.configService.values.limits.maxResultChars)
                        } : r.payload
                    })));

                    contextFound += `\n\n### ADDITIONAL RAG SEARCH RESULTS FOR "${query}" ###\n` + formattedAdditionalDocs;
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
        };
    }

    private cleanHistoryForReport(messages: OpenAI.Chat.ChatCompletionMessageParam[]): any[] {
        return messages.map((m) => {
            const cleanMessage = { ...m };
            if (cleanMessage.role === "assistant" && typeof cleanMessage.content === "string") {
                // Remove code blocks from assistant content to save space, as they are parsed separately
                cleanMessage.content = cleanMessage.content.replace(/```[\s\S]*?```/g, "[Generated Code Block]");
            }
            if ((cleanMessage as any).tool_calls) {
                // Also clean tool calls if they contain large code strings
                (cleanMessage as any).tool_calls = (cleanMessage as any).tool_calls.map((tc: any) => {
                    if (tc.function?.name === "smoke_test_code" && tc.function?.arguments) {
                        try {
                            const args = JSON.parse(tc.function.arguments);
                            if (args.code) args.code = "[Code Snippet Truncated]";
                            return { ...tc, function: { ...tc.function, arguments: JSON.stringify(args) } };
                        } catch {
                            return tc;
                        }
                    }
                    return tc;
                });
            }
            return cleanMessage;
        });
    }

    private async runResearchPhase(
        vectorCollectionName: string,
        userGoal: string,
        onProgress: ProgressCallback,
    ): Promise<{ initialDocsContent: string; contextFound: string; messages: OpenAI.Chat.ChatCompletionMessageParam[] }> {
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
            tools: [SEARCH_TOOL],
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
                                content: (r.payload.content || "").substring(0, this.configService.values.limits.maxResultChars),
                            }
                            : r.payload,
                    }));
                    return JSON.stringify(truncated);
                },
            },
            modelName: this.configService.values.openAI.modelName,
            readySignal: "READY_FOR_GENERATION",
            maxIterations: this.configService.values.limits.maxResearchIterations,
            maxContextChars: this.configService.values.limits.maxContextChars,
            phaseLabel: "Agentic RAG Research",
            ...this.loopParams(),
            onTrace: traceTracker
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
    ): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
        // Smartly prune documentation before verification to stay within token budget
        const query = userGoal.substring(0, 2000);
        const maxDocsChars = this.configService.values.limits.maxScenarioDocsChars;

        const combinedRaw = `#### Initial Documentation:\n${initialDocsContent}\n\n#### Researched Documentation:\n${contextFound}`;
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
                                content: (r.payload.content || "").substring(0, this.configService.values.limits.maxResultChars),
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

                    return testResult;
                },
            },
            modelName: this.configService.values.openAI.modelName,
            readySignal: "VERIFICATION_COMPLETE",
            maxIterations: this.configService.values.limits.maxVerificationIterations,
            maxContextChars: this.configService.values.limits.maxContextChars,
            phaseLabel: "Verification",
            ...this.loopParams(),
            onTrace: traceTracker
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
        const verificationCompleteIdx = verificationMessages.findLastIndex(m => 
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
            .map((m) =>
                `ROLE: ${m.role}\n${
                    m.content ||
                    ((m as any).tool_calls ? JSON.stringify((m as any).tool_calls) : "")
                }`
            )
            .join("\n\n---\n");

        const genUserPrompt =
            `### TESTED EXAMPLES HISTORY:\n${testedHistory}\n\n### TASK\nExtract the working examples from the history above and format them precisely into the requested JSON structure.`;

        const genResponse: any = await this.openai.chat.completions.create({
            model: this.configService.values.openAI.modelName,
            messages: [
                { role: "system", content: templates.GENERATION_SYSTEM_PROMPT },
                { role: "user", content: genUserPrompt },
            ],
            response_format: { type: "json_object" },
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
                    (res.payload?.content || "No content").substring(0, this.configService.values.limits.maxResultChars)
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
            this.logger.log(query);
            const collection = await this.vectorCollectionFactory.createCollection<
                types.file.FileShard
            >(collectionName);

            const dense = await this.embeddingService.embed(query);
            const sparse = this.embeddingService.sparseEmbed(query);

            // When reranking is enabled, over-fetch then let the reranker cut to `limit`.
            const rerankCfg = this.configService.values.reranker;
            const fetchLimit = rerankCfg.mode === "off"
                ? limit
                : Math.max(limit, rerankCfg.topN);

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
        const prompt =
            `You are a Search Specialist. Given a technical error and the context of what the code was trying to do, generate a single, highly effective search query to find relevant documentation in a knowledge base.

Focus on:
- Core library names
- Specific method or tool names (e.g. npm, playwright, hono)
- The technical root cause

### ERROR:
${error}

### CONTEXT:
${context}

Generate ONLY the search query string, no explanation.`;

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
    ): Promise<types.report.FailureAnalysis> {
        const system =
            `You are a Documentation Quality Analyst. A code example that was written based on library documentation has CRASHED. Your job is to classify WHY it failed by comparing the error to the documentation.`;
        const user =
            `### THE ERROR
${errorMessage}

### THE CODE THAT CRASHED
${scriptContent}

### DOCUMENTATION FRAGMENTS FOUND FOR THIS ERROR
${relatedDocs || "No related documentation was found."}

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
5. PINPOINTED FRAGMENT: Quote the EXACT fragment from the provided documentation that is wrong or missing. Include the filename at the start (e.g. "[api.md]: the problematic line...").
6. PROPOSED FRAGMENT: A corrected/improved version of that documentation fragment.

Respond with a JSON object:
{
    "errorMessage": "the key error line",
    "failedFunction": "the function/method that crashed",
    "documentationGap": "MISSING | AMBIGUOUS | INCORRECT | CONFIG | ENVIRONMENT | UNKNOWN",
    "reasoning": "why you classified it this way",
    "suggestedDocsFix": "concrete suggestion for documentation improvement",
    "pinpointedFragment": "exact quote from the docs",
    "proposedFragment": "how the documentation should look like"
}`;

        const votes = this.configService.values.classifier.votes;
        const candidates: types.report.FailureAnalysis[] = [];
        for (let i = 0; i < votes; i++) {
            try {
                const result = await this.structured(system, user, schemas.FailureAnalysisSchema);
                candidates.push(result as unknown as types.report.FailureAnalysis);
            } catch (error) {
                this.logger.error(error, `Failed to classify failure (vote ${i + 1})`);
            }
        }

        if (candidates.length === 0) {
            return {
                errorMessage: errorMessage.substring(0, 200),
                failedFunction: "unknown",
                documentationGap: "UNKNOWN",
                reasoning: "Classification failed due to LLM error",
                suggestedDocsFix: "Manual review required",
            };
        }

        // Self-consistency: majority vote on the category, then return a
        // representative full analysis that agrees with the winning category.
        const winningGap = this.majorityGap(candidates.map((c) => c.documentationGap));
        return candidates.find((c) => c.documentationGap === winningGap) ?? candidates[0];
    }

    private majorityGap(gaps: types.report.DocumentationGap[]): types.report.DocumentationGap {
        const counts = new Map<types.report.DocumentationGap, number>();
        for (const g of gaps) counts.set(g, (counts.get(g) || 0) + 1);
        let best = gaps[0];
        let bestCount = 0;
        for (const g of gaps) {
            const c = counts.get(g)!;
            if (c > bestCount) {
                bestCount = c;
                best = g;
            }
        }
        return best;
    }

    private async rankAndFilterDocs(
        content: string,
        query: string,
        maxChars: number,
    ): Promise<string> {
        if (content.length <= maxChars) return content;

        // Split by document markers (formatSearchResults emits
        // "--- DOCUMENT N (Score: x) ---", so match the trailing metadata too).
        const chunks = content.split(/--- DOCUMENT \d+[^\n]*---/).filter((c) => c.trim().length > 0);
        if (chunks.length <= 1) {
            // If no markers, fallback to double newlines
            const fallbackChunks = content.split("\n\n").filter((c) => c.trim().length > 0);
            if (fallbackChunks.length > 1) return this.rankAndFilterDocsByChunks(fallbackChunks, query, maxChars);
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

            let result = "";
            for (const sc of scoredChunks) {
                if ((result.length + sc.content.length) > maxChars) continue;
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
        files: { metadata: any; buffer: Uint8Array }[],
        maxGoals: number = 5,
        onProgress?: ProgressCallback,
    ): Promise<string[]> {
        this.logger.log(`Generating user goals using agentic loop...`);
        emitLog(onProgress, `Generating user goals using agentic loop...`);

        // 1. Router
        const goal = `Explore the project and identify up to ${maxGoals} primary user goals or test scenarios for this API/library.`;
        const plan = await this.promptForExecutionPlan(vectorCollectionName, goal, onProgress);
        const planStepsStr = plan.steps.map(s => `- ${s.stepExplanation} (Action: ${s.action})`).join("\n");

        // 2. Research / Exploration
        const systemPrompt = `You are a Research Agent finding user goals.
Your goal is to gather enough context to suggest ${maxGoals} distinct user goals.
Follow this plan:
${planStepsStr}

When you have enough context, reply with EXACTLY "READY_FOR_GENERATION".`;

        const messages: import("@openai/openai").default.Chat.ChatCompletionMessageParam[] = [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Start your research.` }
        ];

        const toolHandlers = {
            search_knowledge_base: async (_id: string, rawArgs: any) => {
                const args = rawArgs as SearchToolArgs;
                emitLog(onProgress, `Agent searching: "${args.query}"`);
                const results = await this.performRAGSearch(vectorCollectionName, args.query, this.configService.values.limits.defaultSearchLimit);
                const truncated = results.map((r) => ({ ...r, payload: r.payload ? { ...r.payload, content: (r.payload.content || "").substring(0, this.configService.values.limits.maxResultChars) } : r.payload }));
                return JSON.stringify(truncated);
            },
            ...this.createVfsToolHandlers(files, onProgress)
        };

        const traceTracker = await this.createTraceTracker("Goals Generation Phase", "Discover documentation goals");

        const finalMessages = await runAgenticLoop(this.openai, this.logger, onProgress, {
            modelName: this.configService.values.openAI.modelName,
            messages,
            tools: [SEARCH_TOOL, LIST_FILES_TOOL, READ_FILE_TOOL, HEAD_FILE_TOOL, TAIL_FILE_TOOL, GREP_FILE_TOOL],
            toolHandlers,
            readySignal: "READY_FOR_GENERATION",
            maxIterations: this.configService.values.limits.maxResearchIterations,
            maxContextChars: this.configService.values.limits.maxContextChars,
            phaseLabel: "Goals Research",
            ...this.loopParams(),
            onTrace: traceTracker
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

        const contextFound = (agentSynthesis + "\n\n" + toolResults).substring(0, this.configService.values.limits.maxContextChars);

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

    public async promptForMasterSummary(reportsData: any, _onProgress?: ProgressCallback): Promise<{ structured: types.planner.StructuredMasterSummary; markdown: string }> {
        this.logger.log(`Generating master summary report...`);

        try {
            const structured = await this.structured(
                templates.PLANNER_SUMMARY_SYSTEM_PROMPT,
                templates.createPlannerSummaryUserPrompt(JSON.stringify(reportsData, null, 2)),
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

    private createVfsToolHandlers(files: { metadata: any; buffer: Uint8Array }[], onProgress?: ProgressCallback) {
        return {
            list_files: async () => {
                emitLog(onProgress, "Agent listing VFS files.");
                return files.map(f => f.metadata.filename).join("\n") || "No files available.";
            },
            read_file: async (_id: string, args: any) => {
                emitLog(onProgress, `Agent reading file: ${args.filename}`);
                const file = files.find(f => f.metadata.filename === args.filename);
                if (!file) return `File not found: ${args.filename}`;
                return new TextDecoder().decode(file.buffer);
            },
            head_file: async (_id: string, args: any) => {
                const linesCount = args.lines || 50;
                emitLog(onProgress, `Agent reading head of file: ${args.filename} (${linesCount} lines)`);
                const file = files.find(f => f.metadata.filename === args.filename);
                if (!file) return `File not found: ${args.filename}`;
                const content = new TextDecoder().decode(file.buffer);
                return content.split("\n").slice(0, linesCount).join("\n");
            },
            tail_file: async (_id: string, args: any) => {
                const linesCount = args.lines || 50;
                emitLog(onProgress, `Agent reading tail of file: ${args.filename} (${linesCount} lines)`);
                const file = files.find(f => f.metadata.filename === args.filename);
                if (!file) return `File not found: ${args.filename}`;
                const content = new TextDecoder().decode(file.buffer);
                const lines = content.split("\n");
                return lines.slice(Math.max(0, lines.length - linesCount)).join("\n");
            },
            grep_file: async (_id: string, args: any) => {
                emitLog(onProgress, `Agent grepping file: ${args.filename} for pattern: ${args.pattern}`);
                const file = files.find(f => f.metadata.filename === args.filename);
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
                        result += `[Line ${i+1}]: ${lines[i]}\n`;
                    }
                }
                return result || `No matches found for ${args.pattern} in ${args.filename}`;
            }
        };
    }

    private async createTraceTracker(phase: string, goal?: string, testSuiteId?: string) {
        const trace = await this.traceRepository.create({
            id: crypto.randomUUID() as any,
            phase,
            goal,
            testSuiteId,
            events: []
        });

        return async (event: import("../types/index.ts").trace.TraceEvent) => {
            await this.traceRepository.addEvent(trace.id, event);
        };
    }
}
