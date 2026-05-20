import OpenAI from "@openai/openai";
import { Logger } from "../Logger.ts";
import { EmbeddingService } from "./EmbeddingService.ts";
import { VectorCollectionFactory } from "../db/vectordb/VectorCollectionFactory.ts";
import * as types from "../types/index.ts";

import {
    DEFAULT_SEARCH_LIMIT,
    MAX_CONTEXT_CHARS,
    MAX_RESEARCH_ITERATIONS,
    MAX_RESULT_CHARS,
    MAX_SCENARIO_DOCS_CHARS,
    MAX_VERIFICATION_ITERATIONS,
    MODEL_NAME,
    SEARCH_TOOL,
    SMOKE_TEST_TOOL,
} from "./prompt/constants.ts";
import { emitLog, emitToken, ProgressCallback } from "./prompt/helpers.ts";
import {
    CodeGenerationResponse,
    PromptOptions,
    SearchToolArgs,
    SmokeTestCallback,
    SmokeTestToolArgs,
    StructuredResponse,
} from "./prompt/types.ts";
import * as templates from "./prompt/templates.ts";
import { runAgenticLoop } from "./prompt/agenticLoop.ts";

export type { CodeGenerationResponse, PromptOptions, StructuredResponse } from "./prompt/types.ts";

export class PromptService {
    constructor(
        private openai: OpenAI,
        private logger: Logger,
        private embeddingService: EmbeddingService,
        private vectorCollectionFactory: VectorCollectionFactory,
    ) {}

    public async promptForApiUsageScenario(
        docs: string,
        startingContext: string,
        options: PromptOptions = {},
        onProgress?: ProgressCallback,
    ): Promise<StructuredResponse> {
        const query = `${options.userPreferences || ""} ${startingContext}`.substring(0, 2000);
        
        const smartDocs = await this.rankAndFilterDocs(docs, query, MAX_SCENARIO_DOCS_CHARS);
        const smartCtx = await this.rankAndFilterDocs(startingContext, query, MAX_CONTEXT_CHARS);

        const systemPrompt = templates.createSystemPrompt(options.mandatoryImports);
        const userPrompt = templates.createUserPrompt(
            smartDocs,
            smartCtx,
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
    ): Promise<{ response: CodeGenerationResponse; history: any[] }> {
        this.logger.log(`Starting Agentic RAG for goal: "${userGoal}"`);
        emitLog(onProgress, `Starting Agentic RAG for goal: "${userGoal}"`);

        const { initialDocsContent, contextFound, messages: researchMessages } = await this.runResearchPhase(
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
            DEFAULT_SEARCH_LIMIT,
        );
        const initialDocsContent = this.formatSearchResults(initialSearchResults);

        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: "system", content: templates.RESEARCH_SYSTEM_PROMPT },
            {
                role: "user",
                content: templates.createResearchUserPrompt(initialDocsContent, userGoal),
            },
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
                    const truncated = results.map((r) => ({
                        ...r,
                        payload: r.payload
                            ? {
                                ...r.payload,
                                content: (r.payload.content || "").substring(0, MAX_RESULT_CHARS),
                            }
                            : r.payload,
                    }));
                    return JSON.stringify(truncated);
                },
            },
            readySignal: "READY_FOR_GENERATION",
            maxIterations: MAX_RESEARCH_ITERATIONS,
            phaseLabel: "Agentic RAG Research",
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
            MAX_CONTEXT_CHARS,
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
        const MAX_DOCS_CHARS = 50_000;
        
        const combinedRaw = `#### Initial Documentation:\n${initialDocsContent}\n\n#### Researched Documentation:\n${contextFound}`;
        const smartDocs = await this.rankAndFilterDocs(combinedRaw, query, MAX_DOCS_CHARS);

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
                ),
            },
        ];

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
                        DEFAULT_SEARCH_LIMIT,
                    );
                    const truncated = results.map((r) => ({
                        ...r,
                        payload: r.payload
                            ? {
                                ...r.payload,
                                content: (r.payload.content || "").substring(0, MAX_RESULT_CHARS),
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

        const genResponse = await this.openai.chat.completions.create({
            model: MODEL_NAME,
            messages: [
                { role: "system", content: templates.GENERATION_SYSTEM_PROMPT },
                {
                    role: "user",
                    content:
                        `### TESTED EXAMPLES HISTORY:\n${testedHistory}\n\n### TASK\nExtract the working examples from the history above and format them precisely into the requested JSON structure.`,
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
                `--- DOCUMENT ${i + 1} (Score: ${res.score}) ---\n${
                    (res.payload?.content || "No content").substring(0, MAX_RESULT_CHARS)
                }\n`
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
                model: MODEL_NAME,
                messages: [{ role: "user", content: prompt }],
            });

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
        const prompt =
            `You are a Documentation Quality Analyst. A code example that was written based on library documentation has CRASHED. Your job is to classify WHY it failed by comparing the error to the documentation.

### THE ERROR
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
2. Whether the documentation is MISSING (no docs exist for this function), AMBIGUOUS (docs exist but are unclear/confusing), INCORRECT (docs say one thing but the library does another), CONFIG (library needs undocumented configuration/setup), or UNKNOWN (cannot determine)
3. Your reasoning
4. A concrete suggestion for how the documentation should be fixed
5. **PINPOINTED FRAGMENT**: Quote the EXACT fragment from the provided documentation that is wrong or missing information. **CRITICAL**: Include the filename at the beginning of the fragment (e.g., "[api.md]: the problematic line...").
6. **PROPOSED FRAGMENT**: Provide a corrected or improved version of that documentation fragment.

Respond with a JSON object:
{
    "errorMessage": "the key error line",
    "failedFunction": "the function/method that crashed",
    "documentationGap": "MISSING" | "AMBIGUOUS" | "INCORRECT" | "CONFIG" | "UNKNOWN",
    "reasoning": "why you classified it this way",
    "suggestedDocsFix": "concrete suggestion for documentation improvement",
    "pinpointedFragment": "exact quote from the docs",
    "proposedFragment": "how the documentation should look like"
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

    private async rankAndFilterDocs(
        content: string,
        query: string,
        maxChars: number,
    ): Promise<string> {
        if (content.length <= maxChars) return content;

        // Split by document markers or double newlines
        const chunks = content.split(/--- DOCUMENT \d+ ---/).filter((c) => c.trim().length > 0);
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
            const queryVector = (await this.embeddingService.embed(query))[0];
            const chunkVectors = await Promise.all(
                chunks.map(async (c) => ({
                    content: c,
                    vector: (await this.embeddingService.embed(c.substring(0, 3000)))[0],
                })),
            );

            const scoredChunks = chunkVectors.map((cv) => ({
                content: cv.content,
                score: this.cosineSimilarity(queryVector, cv.vector as number[]),
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

    public async promptForUserGoals(docs: string, onProgress?: ProgressCallback): Promise<string[]> {
        this.logger.log(`Generating user goals from documentation...`);
        emitLog(onProgress, `Generating user goals from documentation...`);

        try {
            const response = await this.openai.chat.completions.create({
                model: MODEL_NAME,
                messages: [
                    { role: "system", content: templates.PLANNER_GOALS_SYSTEM_PROMPT },
                    { role: "user", content: templates.createPlannerGoalsUserPrompt(docs) },
                ],
                response_format: { type: "json_object" }, // Wait, the prompt asks for an array. Let's wrap in an object for JSON mode.
            });

            // Wait, if response_format is json_object, the prompt must ask for an object. Let's fix that in templates in next step, or just parse it.
            // Actually, if it's an array, json_object might throw an error. Let me use default text response.
            // But for now, let's just parse whatever it returns.
            const content = response.choices[0]?.message?.content;
            if (!content) throw new Error("Empty response");

            let parsed = JSON.parse(content);
            if (!Array.isArray(parsed)) {
                // If the LLM wrapped it in an object like { "goals": [...] }
                const maybeArray = Object.values(parsed).find(Array.isArray);
                if (maybeArray) {
                    parsed = maybeArray;
                } else {
                    throw new Error("Could not find an array of goals in the response");
                }
            }

            return parsed as string[];
        } catch (error) {
            this.logger.error(error, "Failed to generate user goals");
            return [];
        }
    }

    public async promptForMasterSummary(reportsData: any, onProgress?: ProgressCallback): Promise<string> {
        this.logger.log(`Generating master summary report...`);
        emitLog(onProgress, `Generating master summary report...`);

        try {
            const response = await this.openai.chat.completions.create({
                model: MODEL_NAME,
                messages: [
                    { role: "system", content: templates.PLANNER_SUMMARY_SYSTEM_PROMPT },
                    { role: "user", content: templates.createPlannerSummaryUserPrompt(JSON.stringify(reportsData)) },
                ],
                stream: true,
            });

            let markdown = "";
            for await (const chunk of response) {
                const content = chunk.choices[0]?.delta?.content || "";
                if (content) {
                    markdown += content;
                    emitToken(onProgress, content);
                }
            }
            return markdown;
        } catch (error) {
            this.logger.error(error, "Failed to generate master summary report");
            return "Failed to generate summary report.";
        }
    }
}
