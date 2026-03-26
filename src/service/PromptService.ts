import OpenAI from "@openai/openai";
import { Logger } from "../Logger.ts";
import { EmbeddingService } from "./EmbeddingService.ts";
import { VectorCollectionFactory } from "../db/vectordb/VectorCollectionFactory.ts";
import * as types from "../types/index.ts";

import {
    MODEL_NAME,
    DEFAULT_SEARCH_LIMIT,
    MAX_RESEARCH_ITERATIONS,
    MAX_VERIFICATION_ITERATIONS,
    MAX_RESULT_CHARS,
    MAX_CONTEXT_CHARS,
    SEARCH_TOOL,
    SMOKE_TEST_TOOL,
} from "./prompt/constants.ts";
import {
    ProgressCallback,
    emitLog,
    emitToken,
} from "./prompt/helpers.ts";
import {
    StructuredResponse,
    CodeGenerationResponse,
    PromptOptions,
    SmokeTestCallback,
    SearchToolArgs,
    SmokeTestToolArgs,
} from "./prompt/types.ts";
import * as templates from "./prompt/templates.ts";
import { runAgenticLoop } from "./prompt/agenticLoop.ts";

export type { StructuredResponse, CodeGenerationResponse, PromptOptions } from "./prompt/types.ts";

export class PromptService {
    constructor(
        private openai: OpenAI,
        private logger: Logger,
        private embeddingService: EmbeddingService,
        private vectorCollectionFactory: VectorCollectionFactory,
    ) { }

    public async promptForApiUsageScenario(
        docs: string,
        startingContext: string,
        options: PromptOptions = {},
        onProgress?: ProgressCallback,
    ): Promise<StructuredResponse> {
        const systemPrompt = templates.createSystemPrompt(options.mandatoryImports);
        const userPrompt = templates.createUserPrompt(
            docs,
            startingContext,
            options.minimalLength || 10,
            options.maximalLength || 20,
            options.userPreferences,
        );

        try {
            const stepRange = `${options.minimalLength || 10}-${options.maximalLength || 20}`;
            this.logger.log(`Prompting OpenAI (Steps: ${stepRange})...`);
            emitLog(onProgress, `Prompting OpenAI (Steps: ${stepRange})...`);

            const response = await this.openai.chat.completions.create({
                model: MODEL_NAME,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt },
                ],
                response_format: { type: "json_object" },
            });

            const jsonString = response.choices[0]?.message?.content;
            if (!jsonString) throw new Error("Received empty response from OpenAI.");

            return JSON.parse(jsonString) as StructuredResponse;
        } catch (error) {
            this.logger.error(error, "Error communicating with OpenAI");
            throw new Error("Failed to get response from OpenAI.");
        }
    }

    public async promptForCodeGenerationWithAgenticRAG(
        vectorCollectionName: string,
        userGoal: string,
        onProgress?: ProgressCallback,
        smokeTestCallback?: SmokeTestCallback,
    ): Promise<CodeGenerationResponse> {
        this.logger.log(`Starting Agentic RAG for goal: "${userGoal}"`);
        emitLog(onProgress, `Starting Agentic RAG for goal: "${userGoal}"`);

        const { initialDocsContent, contextFound } = await this.runResearchPhase(
            vectorCollectionName,
            userGoal,
            onProgress,
        );

        const verificationMessages = await this.runVerificationPhase(
            vectorCollectionName,
            initialDocsContent,
            contextFound,
            userGoal,
            onProgress,
            smokeTestCallback,
        );

        return this.runGenerationPhase(verificationMessages, onProgress);
    }

    private async runResearchPhase(
        vectorCollectionName: string,
        userGoal: string,
        onProgress: ProgressCallback,
    ): Promise<{ initialDocsContent: string; contextFound: string }> {
        const initialSearchResults = await this.performRAGSearch(
            vectorCollectionName,
            userGoal,
            DEFAULT_SEARCH_LIMIT,
        );
        const initialDocsContent = this.formatSearchResults(initialSearchResults);

        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: "system", content: templates.RESEARCH_SYSTEM_PROMPT },
            { role: "user", content: templates.createResearchUserPrompt(initialDocsContent, userGoal) },
        ];

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
                        DEFAULT_SEARCH_LIMIT,
                    );
                    const truncated = results.map(r => ({
                        ...r,
                        payload: r.payload ? {
                            ...r.payload,
                            content: (r.payload.content || "").substring(0, MAX_RESULT_CHARS),
                        } : r.payload,
                    }));
                    return JSON.stringify(truncated);
                },
            },
            readySignal: "READY_FOR_GENERATION",
            maxIterations: MAX_RESEARCH_ITERATIONS,
            phaseLabel: "Agentic RAG Research",
        });

        const agentSynthesis = finalMessages
            .filter(m => m.role === "assistant" && typeof m.content === "string" && m.content)
            .map(m => m.content as string)
            .join("\n\n");

        const toolResults = finalMessages
            .filter(m => m.role === "tool")
            .map(m => typeof m.content === "string" ? m.content : "")
            .join("\n\n");

        const contextFound = (agentSynthesis + "\n\n" + toolResults).substring(0, MAX_CONTEXT_CHARS);

        return { initialDocsContent, contextFound };
    }

    private async runVerificationPhase(
        vectorCollectionName: string,
        initialDocsContent: string,
        contextFound: string,
        userGoal: string,
        onProgress: ProgressCallback,
        smokeTestCallback?: SmokeTestCallback,
    ): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
        this.logger.log(`Agentic RAG Verification Phase (Smoke Testing)...`);
        emitLog(onProgress, `Agentic RAG Verification Phase... Smoke testing examples in Docker.`);

        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: "system", content: templates.VERIFICATION_SYSTEM_PROMPT },
            { role: "user", content: templates.createVerificationUserPrompt(initialDocsContent, contextFound, userGoal) },
        ];

        return runAgenticLoop(this.openai, this.logger, onProgress, {
            messages,
            tools: [SMOKE_TEST_TOOL, SEARCH_TOOL],
            toolHandlers: {
                search_knowledge_base: async (_id, rawArgs) => {
                    const args = rawArgs as SearchToolArgs;
                    emitLog(onProgress, `Agent RAG searching knowledge base (Verification phase) for: "${args.query}"`);
                    const results = await this.performRAGSearch(
                        vectorCollectionName,
                        args.query,
                        DEFAULT_SEARCH_LIMIT,
                    );
                    const truncated = results.map(r => ({
                        ...r,
                        payload: r.payload ? {
                            ...r.payload,
                            content: (r.payload.content || "").substring(0, MAX_RESULT_CHARS),
                        } : r.payload,
                    }));
                    return JSON.stringify(truncated);
                },
                smoke_test_code: async (_id, rawArgs) => {
                    const args = rawArgs as SmokeTestToolArgs;
                    emitLog(onProgress, `Running Smoke Test... Env: ${args.environment}, Deps: [${args.dependencies.join(", ")}]`);

                    let testResult = "Tool not available locally.";
                    if (smokeTestCallback) {
                        try {
                            testResult = await smokeTestCallback(args.code, args.environment, args.dependencies);
                        } catch (e) {
                            testResult = `FATAL RUNTIME ERROR: ${e instanceof Error ? e.message : String(e)}`;
                        }
                    }

                    const status = testResult.startsWith("SUCCESS") ? "Passed" : "Failed";
                    emitLog(onProgress, `Smoke Test ${status}:\n${testResult}`);

                    return testResult;
                },
            },
            readySignal: "VERIFICATION_COMPLETE",
            maxIterations: MAX_VERIFICATION_ITERATIONS,
            phaseLabel: "Verification",
        });
    }

    private async runGenerationPhase(
        verificationMessages: OpenAI.Chat.ChatCompletionMessageParam[],
        onProgress: ProgressCallback,
    ): Promise<CodeGenerationResponse> {
        this.logger.log(`Agentic RAG Generation Phase...`);
        emitLog(onProgress, `Agentic RAG Finalizing Phase... Formatting verified code into final response.`);

        const relevantMessages = verificationMessages.filter((m, i, arr) => {
            if (m.role === "system" || (m.role === "user" && i <= 1)) return true;
            if (m.role === "tool" && typeof m.content === "string" && m.content.startsWith("SUCCESS")) return true;
            if (m.role === "assistant" && i + 1 < arr.length) {
                for (let j = i + 1; j < Math.min(i + 5, arr.length); j++) {
                    if (arr[j].role === "tool" && typeof arr[j].content === "string" && (arr[j].content as string).startsWith("SUCCESS")) return true;
                }
            }
            if (m.role === "assistant" && typeof m.content === "string" && m.content.includes("VERIFICATION_COMPLETE")) return true;
            return false;
        });

        const testedHistory = relevantMessages
            .map(m => `ROLE: ${m.role}\n${m.content || ((m as any).tool_calls ? JSON.stringify((m as any).tool_calls) : '')}`)
            .join("\n\n---\n");

        const genResponse = await this.openai.chat.completions.create({
            model: MODEL_NAME,
            messages: [
                { role: "system", content: templates.GENERATION_SYSTEM_PROMPT },
                {
                    role: "user",
                    content: `### TESTED EXAMPLES HISTORY:\n${testedHistory}\n\n### TASK\nExtract the working examples from the history above and format them precisely into the requested JSON structure.`,
                },
            ],
            response_format: { type: "json_object" },
            stream: true,
        });

        let jsonString = "";
        for await (const chunk of genResponse) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
                jsonString += content;
                emitToken(onProgress, content);
            }
        }

        return JSON.parse(jsonString) as CodeGenerationResponse;
    }

    private formatSearchResults(
        results: types.vector.SearchResult<types.file.FileShard>[],
    ): string {
        return results
            .map((res, i) =>
                `--- DOCUMENT ${i + 1} (Score: ${res.score}) ---\n${(res.payload?.content || "No content").substring(0, MAX_RESULT_CHARS)}\n`
            )
            .join("\n");
    }

    private async performRAGSearch(
        collectionName: string,
        query: string,
        limit: number = DEFAULT_SEARCH_LIMIT,
    ): Promise<types.vector.SearchResult<types.file.FileShard>[]> {
        try {
            this.logger.log(query);
            const collection = await this.vectorCollectionFactory.createCollection<
                types.file.FileShard
            >(collectionName);

            const dense = await this.embeddingService.embed(query);
            const sparse = this.embeddingService.sparseEmbed(query);

            return await collection.searchHybrid(
                dense[0] as types.vector.DenseVector,
                sparse,
                limit,
            );
        } catch (error) {
            const err = error as types.vector.QdrantError;
            const errorData = err?.data?.status?.error || err?.message || String(error);
            this.logger.error(
                `RAG search failed for collection "${collectionName}": ${JSON.stringify(errorData).substring(0, 300)}`,
            );
            return [];
        }
    }

    public async refineSearchQuery(
        error: string,
        context: string,
    ): Promise<string> {
        const prompt = `You are a Search Specialist. Given a technical error and the context of what the code was trying to do, generate a single, highly effective search query to find relevant documentation in a knowledge base.

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
                model: MODEL_NAME,
                messages: [{ role: "user", content: prompt }],
            });

            return response.choices[0]?.message?.content?.trim() || `${error} ${context}`.substring(0, 500);
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
        const prompt = `You are a Documentation Quality Analyst. A code example that was written based on library documentation has CRASHED. Your job is to classify WHY it failed by comparing the error to the documentation.

### THE ERROR
${errorMessage}

### THE CODE THAT CRASHED
${scriptContent}

### DOCUMENTATION FRAGMENTS FOUND FOR THIS ERROR
${relatedDocs || "No related documentation was found."}

### WHAT THE CODE WAS TRYING TO DO
${stepDescription}

### YOUR TASK
Analyze the error and the documentation. Determine:
1. Which function/method call caused the crash
2. Whether the documentation is MISSING (no docs exist for this function), AMBIGUOUS (docs exist but are unclear/confusing), INCORRECT (docs say one thing but the library does another), CONFIG (library needs undocumented configuration/setup), or UNKNOWN (cannot determine)
3. Your reasoning
4. A concrete suggestion for how the documentation should be fixed

Respond with a JSON object:
{
    "errorMessage": "the key error line",
    "failedFunction": "the function/method that crashed",
    "documentationGap": "MISSING" | "AMBIGUOUS" | "INCORRECT" | "CONFIG" | "UNKNOWN",
    "reasoning": "why you classified it this way",
    "suggestedDocsFix": "concrete suggestion for documentation improvement"
}`;

        try {
            const response = await this.openai.chat.completions.create({
                model: MODEL_NAME,
                messages: [{ role: "user", content: prompt }],
                response_format: { type: "json_object" },
            });

            const json = response.choices[0]?.message?.content;
            if (!json) throw new Error("Empty response");

            return JSON.parse(json) as types.report.FailureAnalysis;
        } catch (error) {
            this.logger.error(error, "Failed to classify failure");
            return {
                errorMessage: errorMessage.substring(0, 200),
                failedFunction: "unknown",
                documentationGap: "UNKNOWN",
                reasoning: "Classification failed due to LLM error",
                suggestedDocsFix: "Manual review required",
            };
        }
    }
}
