import OpenAI from "@openai/openai";

// ─── Model & Limits ─────────────────────────────────────────────────────────

export const MODEL_NAME = "gpt-5-mini";
export const MAX_RESEARCH_ITERATIONS = 5;
export const MAX_VERIFICATION_ITERATIONS = 5;
export const DEFAULT_SEARCH_LIMIT = 10;
export const RELATED_DOCS_LIMIT = 10;
export const MAX_RESULT_CHARS = 3000;
export const MAX_CONTEXT_CHARS = 50_000;

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
                bash_setup: {
                    type: "string",
                    description:
                        "Optional bash script to run before the JS code (e.g. for creating, moving or copying files).",
                },
            },
            required: ["code", "environment", "dependencies"],
        },
    },
};
