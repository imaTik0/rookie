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
    ) {}

    private createSystemPrompt(mandatoryImports: string = ""): string {
        return `
### ROLE
You are a Senior Test Automation Engineer. Your goal is to plan a comprehensive test scenario and generate executable JavaScript steps to **test the product**.

### EXECUTION ENVIRONMENT (CRITICAL)
1. **Universal JavaScript:** Your code must be compatible with **BOTH Node.js and Browser** environments.
2. **Forbidden Globals:** - ❌ DO NOT use \`Buffer\` (Node-specific). 
   - ✅ USE \`Uint8Array\` for binary data.
3. **Context ('ctx'):** - State passed between steps. 
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
    ): Promise<StructuredResponse> {
        const systemPrompt = this.createSystemPrompt(options.mandatoryImports);
        const userPrompt = this.createUserPrompt(docs, startingContext, options);

        try {
            this.logger.log(
                `Prompting OpenAI (Steps: ${options.minimalLength || 10}-${
                    options.maximalLength || 20
                })...`,
            );

            const response = await this.openai.chat.completions.create({
                model: "gpt-4o-mini",
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
    ): Promise<CodeGenerationResponse> {
        this.logger.log(`Starting Agentic RAG for goal: "${userGoal}"`);

        // 1. Initial search to populate starting context
        const initialSearchResults = await this.performRAGSearch(vectorCollectionName, userGoal, 5);
        const initialDocsContent = initialSearchResults
            .map((res, i) =>
                `--- DOCUMENT ${i + 1} (Score: ${res.score}) ---\n${
                    res.payload?.content || "No content"
                }\n`
            )
            .join("\n");

        const systemPrompt = `
### ROLE
You are a Senior Software Engineer specializing in creating high-quality, executable code examples.

### TASK
Create 3-5 high-quality, executable example programs based on the provided documentation and the user's goal.
Each program MUST be a standalone JavaScript file that follows the execution contract.

### EXECUTION CONTRACT (CRITICAL)
1. **Universal JavaScript:** Your code must be compatible with **BOTH Node.js and Browser** environments.
2. **Context ('ctx'):** - State passed between steps. 
3. **Return Signature:** Return an object: \`{ result: <api_response>, ctx: <updated_context> }\`.
4. **Structure:** Export a default async function that accepts \`ctx\`.

\`\`\`javascript
export default async (ctx) => {
    // ... logic ...
    return { result: response, ctx };
}
\`\`\`

### TOOLS
You have access to 'search_knowledge_base' tool. 
CRITICAL: You are given a small set of initial search results. If they are insufficient or you need more details about other APIs, functions, or patterns, you MUST use this tool to search the vector database.

### OUTPUT FORMAT
You MUST respond with a valid JSON object.
Structure:
{
    "examples": [
        {
            "title": "Example Title",
            "explanation": "What this example does",
            "fullProgram": "The complete JS code starting with exports/imports"
        }
    ],
    "finalMarkdownSummary": "Overall summary of all examples in Markdown"
}
`;

        const userPrompt = `
### INITIAL CONTEXT (TOP RELEVANT FRAGMENTS)
${initialDocsContent}

### USER GOAL
${userGoal}

### INSTRUCTIONS
1. Analyze the initial context. 
2. Use the 'search_knowledge_base' tool if you need more information from the documentation to fulfill the goal.
3. Generate the JSON response with executable programs.
`;

        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
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
        const maxIterations = 5;

        while (iterations < maxIterations) {
            this.logger.log(`Agentic RAG Iteration ${iterations + 1}...`);
            const response = await this.openai.chat.completions.create({
                model: "gpt-4o",
                messages,
                tools,
                tool_choice: "auto",
                response_format: { type: "json_object" },
            });

            const message = response.choices[0].message;
            messages.push(message);

            if (message.tool_calls && message.tool_calls.length > 0) {
                for (const toolCall of message.tool_calls) {
                    if (toolCall.function.name === "search_knowledge_base") {
                        const args = JSON.parse(toolCall.function.arguments);
                        const searchResults = await this.performRAGSearch(
                            vectorCollectionName,
                            args.query,
                            args.limit,
                        );
                        messages.push({
                            role: "tool",
                            tool_call_id: toolCall.id,
                            content: JSON.stringify(searchResults),
                        });
                    }
                }
                iterations++;
            } else {
                return JSON.parse(message.content || "{}") as CodeGenerationResponse;
            }
        }

        throw new Error("Maximum iterations reached without a final JSON response.");
    }

    private async performRAGSearch(
        collectionName: string,
        query: string,
        limit: number = 5,
    ): Promise<types.vector.SearchResult<types.file.FileShard>[]> {
        try {
            const collection = await this.vectorCollectionFactory.createCollection<
                types.file.FileShard
            >(
                collectionName,
            );

            const dense = await this.embeddingService.embed(query);
            const sparse = this.embeddingService.sparseEmbed(query);

            return await collection.searchHybrid(dense[0] as types.vector.DenseVector, sparse, limit);
        } catch (error) {
            const err = error as types.vector.QdrantError;
            const errorData = err?.data?.status?.error || err?.message || String(error);
            this.logger.error(
                `RAG search failed for collection "${collectionName}": ${JSON.stringify(errorData).substring(0, 300)}`,
            );
            return [];
        }
    }
}
