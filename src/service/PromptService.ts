import OpenAI from "@openai/openai";
import { Logger } from "../Logger.ts";
import { EmbeddingService } from "./EmbeddingService.ts";
import { VectorCollectionFactory } from "../db/vectordb/VectorCollectionFactory.ts";
import * as types from "../types/index.ts";

export interface StructuredResponse {
    calls: {
        stepExplanation: string;
        fetch: string;
        returnValueName: string;
    }[];
}

export interface CodeGenerationResponse {
    examples: {
        title: string;
        explanation: string;
        fullProgram: string;
        environment: "node" | "browser";
        dependencies: string[];
    }[];
    finalMarkdownSummary: string;
}

export interface PromptOptions {
    minimalLength?: number;
    maximalLength?: number;
    userPreferences?: string;
    mandatoryImports?: string;
}

export class PromptService {
    constructor(
        private openai: OpenAI,
        private logger: Logger,
        private embeddingService: EmbeddingService,
        private vectorCollectionFactory: VectorCollectionFactory,
    ) { }

    private createSystemPrompt(mandatoryImports: string = ""): string {
        return `
### ROLE
You are a Senior Test Automation Engineer. Your goal is to plan a comprehensive test scenario and generate executable JavaScript steps to **test the product**.

### EXECUTION ENVIRONMENT & RULES (CRITICAL)
1. **NO MOCKING ALLOWED:** 
   - ❌ DO NOT create mock servers, mock data, or simulated functions. 
   - ✅ You MUST make REAL HTTP requests or execute REAL library code. The purpose is to violently test the documentation. If it lacks data, the test SHOULD fail.
2. **Context ('ctx'):** - State passed between steps. 
   - **Constraint:** Pure JSON data only. No sockets, functions, or class instances.
   - You MUST re-establish connections/setup in every step using configuration stored in 'ctx'.

### IMPORT RULES
You may assume the following imports are present and available for use. 
**CONSTRAINT:** You must include these lines at the top of your file, but **DO NOT import anything else on your own**.

\`\`\`javascript
${mandatoryImports}
\`\`\`

### CODE STRUCTURE (THE CONTRACT)
You must generate code that strictly follows this structure:

1. **MAIN FUNCTION:** Export a default async function that accepts \`ctx\`.
2. **DOCUMENTATION COMPLIANCE:** Adhere strictly to the provided API documentation. Do not invent methods that do not exist in the docs.
3. **ERROR HANDLING:**
   - If an API result indicates failure (e.g., \`result.error\`), you MUST throw an Error.
   - **Rule:** You MUST stringify the error object: \`throw new Error(JSON.stringify(result.error, null, 2));\`
4. **RETURN SIGNATURE:**
   Return an object: \`{ result: <api_response>, ctx: <updated_context> }\`.

### TEMPLATE VISUALIZATION
Your output for the \`fetch\` field in the JSON response must look exactly like this:

\`\`\`javascript
${mandatoryImports}

export default async (ctx) => {
    // 1. Re-connect / Setup using ctx data
    // const api = await someImportedLibrary.setup(ctx.apiKey) ... or fetch(ctx.url)

    // 2. Perform Action (Test the product)
    // const response = await api.doSpecificAction(...);

    // 3. Defensive Check
    if (response.error) {
        throw new Error(JSON.stringify(response.error, null, 2));
    }

    // 4. Update Context
    ctx.lastResult = response.data;

    // 5. Return
    return { result: response, ctx };
}
\`\`\`
`;
    }

    private createUserPrompt(
        docs: string,
        startingContext: string,
        config: PromptOptions,
    ): string {
        const min = config.minimalLength || 10;
        const max = config.maximalLength || 20;

        const jsonStructureExample = {
            calls: [{
                stepExplanation: "Detailed description of the test step",
                fetch: "The complete JavaScript source code (imports + export default)",
                returnValueName: "variableName",
            }],
        };

        return `
### TASK
Analyze the provided documentation and prepare a test scenario consisting of **${min} to ${max} steps**.

### INPUT DATA

**1. API Documentation (Source of Truth):**
---
${docs}
---

**2. Starting Context:**
---
${startingContext}
---

**3. User Preferences:**
---
${config.userPreferences || "No specific preferences."}
---

### OUTPUT
Respond with a **valid JSON object** (no markdown formatting).
Structure:
${JSON.stringify(jsonStructureExample, null, 2)}
`;
    }

    public async promptForApiUsageScenario(
        docs: string,
        startingContext: string,
        options: PromptOptions = {},
        onProgress?: (msg: string) => void,
    ): Promise<StructuredResponse> {
        const systemPrompt = this.createSystemPrompt(options.mandatoryImports);
        const userPrompt = this.createUserPrompt(docs, startingContext, options);

        try {
            this.logger.log(`Prompting OpenAI (Steps: ${options.minimalLength || 10}-${options.maximalLength || 20})...`);
            onProgress?.(JSON.stringify({ type: "log", content: `Prompting OpenAI (Steps: ${options.minimalLength || 10}-${options.maximalLength || 20})...` }));

            const response = await this.openai.chat.completions.create({
                model: "gpt-5-mini",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt },
                ],
                response_format: { type: "json_object" },
                // temperature: 0.2,
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
        onProgress?: (msg: string) => void,
        smokeTestCallback?: (code: string, env: "node" | "browser", deps: string[]) => Promise<string>
    ): Promise<CodeGenerationResponse> {
        this.logger.log(`Starting Agentic RAG for goal: "${userGoal}"`);
        onProgress?.(JSON.stringify({ type: "log", content: `Starting Agentic RAG for goal: "${userGoal}"` }));

        // 1. Initial search to populate starting context
        const initialSearchResults = await this.performRAGSearch(vectorCollectionName, userGoal, 25);
        const initialDocsContent = initialSearchResults
            .map((res, i) =>
                `--- DOCUMENT ${i + 1} (Score: ${res.score}) ---\n${res.payload?.content || "No content"
                }\n`
            )
            .join("\n");

        const researchSystemPrompt = `
### ROLE
You are an AI Research Agent building context for coding examples. 

### TASK
Your goal is to prepare for writing high-quality executable code examples by gathering ALL necessary function documentation using the 'search_knowledge_base' tool.
You are given a user goal and an initial context. 

### TOOLS
You have access to the 'search_knowledge_base' tool.
CRITICAL MANDATORY RULE: FOR EVERY function, API, or pattern you plan to use, you MUST find a fragment of documentation related to it if it's not already in the initial context. Do not hallucinate or guess any function usage or signatures whatsoever. Keep calling the tool until you are fully confident you have the exact documentation for EVERY function you will use.

### OUTPUT INSTRUCTIONS
1. FIRST, you MUST establish a step-by-step text PLAN of what you are going to research. Write this plan out in your response text explicitly before calling any tools.
2. After making a plan, iterate through it by calling the 'search_knowledge_base' tool as many times as you need.
3. Once you have retrieved ALL necessary documentation and are completely ready to write the code examples, you MUST reply with exactly this text: "READY_FOR_GENERATION". DO NOT output any code or JSON yet!
`;

        const researchUserPrompt = `
### INITIAL CONTEXT (TOP RELEVANT FRAGMENTS)
${initialDocsContent}

### USER GOAL
${userGoal}

### INSTRUCTIONS
1. Analyze the initial context and the user goal.
2. Plan what libraries and functions you need.
3. Use the 'search_knowledge_base' tool to find documentation for EVERYTHING you need. Do not hesitate to use it multiple times.
4. When you have everything, reply with "READY_FOR_GENERATION".
`;

        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: "system", content: researchSystemPrompt },
            { role: "user", content: researchUserPrompt },
        ];

        const tools: OpenAI.Chat.ChatCompletionTool[] = [
            {
                type: "function",
                function: {
                    name: "search_knowledge_base",
                    description:
                        "Search for additional code fragments in the vector database using hybrid search.",
                    parameters: {
                        type: "object",
                        properties: {
                            query: { type: "string" },
                            limit: { type: "number", default: 5 },
                        },
                        required: ["query"],
                    },
                },
            },
        ];

        let iterations = 0;
        const maxIterations = 8;
        let isReady = false;

        while (iterations < maxIterations && !isReady) {
            this.logger.log(`Agentic RAG Research Iteration ${iterations + 1}...`);
            onProgress?.(JSON.stringify({ type: "log", content: `Agentic RAG Research Iteration ${iterations + 1}...` }));
            const response = await this.openai.chat.completions.create({
                model: "gpt-5-mini",
                messages,
                tools,
                tool_choice: "auto",
            });

            const message = response.choices[0].message;
            messages.push(message);

            if (message.content && !message.content.includes("READY_FOR_GENERATION")) {
                this.logger.log(`RAG Agent Thoughts: ${message.content}`);
                onProgress?.(JSON.stringify({ type: "log", content: `🧠 Agent Thoughts:\n${message.content}` }));
            }

            if (message.tool_calls && message.tool_calls.length > 0) {
                for (const toolCall of message.tool_calls) {
                    if (toolCall.function.name === "search_knowledge_base") {
                        const args = JSON.parse(toolCall.function.arguments);
                        onProgress?.(JSON.stringify({ type: "log", content: `Agent RAG searching knowledge base for: "${args.query}"` }));
                        const searchResults = await this.performRAGSearch(
                            vectorCollectionName,
                            args.query,
                            25,
                        );
                        messages.push({
                            role: "tool",
                            tool_call_id: toolCall.id,
                            content: JSON.stringify(searchResults),
                        });
                    }
                }
            } else if (message.content?.includes("READY_FOR_GENERATION")) {
                isReady = true;
            }
            iterations++;
        }

        // Filter out the initial context and build a clean context payload
        const contextFound = messages
            .filter(m => m.role === "tool")
            .map(m => m.content)
            .join("\n\n");

        const verificationMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            {
                role: "system",
                content: `### ROLE\nYou are a Verification Agent evaluating the feasibility of Javascript Code Examples.\n\n### TASK\nYour goal is to write code examples for the user goal, and test them rigorously using the 'smoke_test_code' tool to ensure they actually run without crashing.\n- If an execution fails, read the logs, fix the code, and try again!\n- You MUST NOT mock the external library behavior.\n- Before calling 'smoke_test_code', you MUST explicitly write out your reasoning text explaining what you wrote, what you expect to achieve, or what error you are trying to fix.\n- Once you have tested 3-5 examples and they all work, reply with EXACTLY "VERIFICATION_COMPLETE". Do not output final formatting yet.`
            },
            {
                role: "user",
                content: `### INITIAL CONTEXT:\n${initialDocsContent}\n\n### RESEARCHED CONTEXT:\n${contextFound}\n\n### USER GOAL:\n${userGoal}\n\nStart writing and testing! Share your thoughts and use the tool!`
            }
        ];

        const verificationTools: OpenAI.Chat.ChatCompletionTool[] = [
            {
                type: "function",
                function: {
                    name: "smoke_test_code",
                    description: "Execute Javascript code in an isolated Docker container to safely verify if it crashes or completes successfully. If it crashes, the tool will return the STDERR logs so you can fix your code.",
                    parameters: {
                        type: "object",
                        properties: {
                            code: { type: "string", description: "The full JS code including imports and a default exported async (ctx) => {} function." },
                            environment: { type: "string", enum: ["node", "browser"], description: "Use 'node' for standard JS API execution, and 'browser' for Playwright UI testing." },
                            dependencies: { type: "array", items: { type: "string" }, description: "Array of exactly named NPM packages required (e.g. ['axios', 'zod']). Do not include built-in modules." }
                        },
                        required: ["code", "environment", "dependencies"]
                    }
                }
            }
        ];

        let vIterations = 0;
        let vReady = false;

        this.logger.log(`Agentic RAG Verification Phase (Smoke Testing)...`);
        onProgress?.(JSON.stringify({ type: "log", content: `Agentic RAG Verification Phase... Smoke testing examples in Docker.` }));

        while (vIterations < 8 && !vReady) {
            const vResponse = await this.openai.chat.completions.create({
                model: "gpt-5-mini",
                messages: verificationMessages,
                tools: verificationTools,
                tool_choice: "auto",
            });

            const vMsg = vResponse.choices[0].message;
            verificationMessages.push(vMsg);

            if (vMsg.content && !vMsg.content.includes("VERIFICATION_COMPLETE")) {
                this.logger.log(`Verification Agent Thoughts: ${vMsg.content}`);
                onProgress?.(JSON.stringify({ type: "log", content: `🧠 Agent Thoughts:\n${vMsg.content}` }));
            }

            if (vMsg.tool_calls && vMsg.tool_calls.length > 0) {
                for (const toolCall of vMsg.tool_calls) {
                    if (toolCall.function.name === "smoke_test_code") {
                        const args = JSON.parse(toolCall.function.arguments);
                        onProgress?.(JSON.stringify({ type: "log", content: `Running Smoke Test... Env: ${args.environment}, Deps: [${args.dependencies.join(", ")}]` }));

                        let testResult = "Tool not available locally.";
                        if (smokeTestCallback) {
                            try {
                                testResult = await smokeTestCallback(args.code, args.environment, args.dependencies);
                            } catch (e: any) {
                                testResult = `FATAL RUNTIME ERROR: ${e.message}`;
                            }
                        }

                        // Emit execution results directly to user
                        const outcomeStatus = testResult.startsWith("SUCCESS") ? "✅ Passed" : "❌ Failed";
                        onProgress?.(JSON.stringify({ type: "log", content: `Smoke Test ${outcomeStatus}:\n${testResult}` }));

                        verificationMessages.push({
                            role: "tool",
                            tool_call_id: toolCall.id,
                            content: testResult,
                        });
                    }
                }
            } else if (vMsg.content?.includes("VERIFICATION_COMPLETE")) {
                vReady = true;
            }
            vIterations++;
        }

        // PHASE 3: GENERATION
        this.logger.log(`Agentic RAG Generation Phase...`);
        onProgress?.(JSON.stringify({ type: "log", content: `Agentic RAG Finalizing Phase... Formatting verified code into final response.` }));

        // Strip out the previous verification system/user prompts to ensure the final JSON generation is fully clean
        const testedHistory = verificationMessages
            .map(m => `ROLE: ${m.role}\n${m.content || (m.tool_calls ? JSON.stringify(m.tool_calls) : '')}`)
            .join("\n\n---\n");

        const generationPrompt = `
### ROLE
You are a Senior Software Engineer specializing in creating high-quality, executable code examples.

### TASK
Now that you have gathered all necessary information in this thread, create 3-5 high-quality, executable example programs based on the previous context and the user's goal.
Each program MUST be a standalone JavaScript file that follows the execution contract.

### EXECUTION CONTRACT (CRITICAL)
1. **Universal JavaScript:** Your code must be compatible with **BOTH Node.js and Browser** environments.
2. **NO MOCKING ALLOWED:** 
   - ❌ DO NOT use mock endpoints, fake APIs, or simulated behavior. 
   - ✅ You MUST import REAL external libraries via \require('...')\ or ES imports.
   - ✅ You MUST make REAL calls to the API specified in the documentation. 
   - Our goal is to TEST the actual product/library. If the documentation is missing crucial steps (like auth), let the code fail. DO NOT invent steps that aren't in the docs.
3. **YOU MUST USE THE TESTED PROJECT:** 
   - ❌ DO NOT just write a generic test that doesn't use the library/project from the documentation!
   - ✅ You MUST explicitly import or \`require()\` the actual library/project described in the documentation and use its methods to test it. This is the entire point.
4. **Context ('ctx'):** - State passed between steps. 
5. **Return Signature:** Return an object: \`{ result: <api_response>, ctx: <updated_context> }\`.
6. **Structure:** Export a default async function that accepts \`ctx\`.

\`\`\`javascript
export default async (ctx) => {
    // ... logic ...
    return { result: response, ctx };
}
\`\`\`

### OUTPUT FORMAT
You MUST respond with a valid JSON object.
Structure:
{
    "examples": [
        {
            "title": "Example Title",
            "explanation": "What this example does",
            "environment": "node", // Or "browser" if UI automation (e.g., Playwright) is strictly required
            "dependencies": ["axios", "zod"], // Array of npm packages required. Do NOT hallucinate built-in modules.
            "fullProgram": "The complete JS code starting with exports/imports"
        }
    ],
    "finalMarkdownSummary": "Overall summary of all examples in Markdown"
}
`;

        const phase3Messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: "system", content: generationPrompt },
            {
                role: "user",
                content: `### TESTED EXAMPLES HISTORY:\n${testedHistory}\n\n### TASK\nExtract the working examples from the history above and format them precisely into the requested JSON structure.`
            }
        ];

        const genResponse = await this.openai.chat.completions.create({
            model: "gpt-5-mini",
            messages: phase3Messages,
            response_format: { type: "json_object" },
            stream: true,
        });

        let jsonString = "";
        for await (const chunk of genResponse) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
                jsonString += content;
                onProgress?.(JSON.stringify({ type: "token", content }));
            }
        }

        return JSON.parse(jsonString) as CodeGenerationResponse;
    }

    private async performRAGSearch(
        collectionName: string,
        query: string,
        limit: number = 5,
    ): Promise<types.vector.SearchResult<types.file.FileShard>[]> {
        try {
            this.logger.log(query)
            const collection = await this.vectorCollectionFactory.createCollection<
                types.file.FileShard
            >(
                collectionName,
            );

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
                `RAG search failed for collection "${collectionName}": ${JSON.stringify(errorData).substring(0, 300)
                }`,
            );
            return [];
        }
    }
}
