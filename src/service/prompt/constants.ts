import OpenAI from "@openai/openai";

// ─── Model & Limits ─────────────────────────────────────────────────────────

export const MODEL_NAME = "gpt-5-mini";
export const MAX_RESEARCH_ITERATIONS = 8;
export const MAX_VERIFICATION_ITERATIONS = 8;
export const DEFAULT_SEARCH_LIMIT = 25;

// ─── Tool Definitions ────────────────────────────────────────────────────────

export const SEARCH_TOOL: OpenAI.Chat.ChatCompletionTool = {
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
};

export const SMOKE_TEST_TOOL: OpenAI.Chat.ChatCompletionTool = {
    type: "function",
    function: {
        name: "smoke_test_code",
        description:
            "Execute Javascript code in an isolated Docker container to safely verify if it crashes or completes successfully. If it crashes, the tool will return the STDERR logs so you can fix your code.",
        parameters: {
            type: "object",
            properties: {
                code: {
                    type: "string",
                    description:
                        "The full JS code including imports and a default exported async (ctx) => {} function.",
                },
                environment: {
                    type: "string",
                    enum: ["node", "browser"],
                    description:
                        "Use 'node' for standard JS API execution, and 'browser' for Playwright UI testing.",
                },
                dependencies: {
                    type: "array",
                    items: { type: "string" },
                    description:
                        "Array of exactly named NPM packages required (e.g. ['axios', 'zod']). Do not include built-in modules.",
                },
            },
            required: ["code", "environment", "dependencies"],
        },
    },
};
