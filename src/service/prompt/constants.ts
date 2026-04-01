import OpenAI from "@openai/openai";

// ─── Model & Limits ─────────────────────────────────────────────────────────

export const MODEL_NAME = "gpt-5.4-mini";
export const MAX_RESEARCH_ITERATIONS = 5;
export const MAX_VERIFICATION_ITERATIONS = 5;
export const DEFAULT_SEARCH_LIMIT = 10;
export const RELATED_DOCS_LIMIT = 25;
export const MAX_RESULT_CHARS = 3000;
export const MAX_CONTEXT_CHARS = 50_000;
export const MAX_SCENARIO_DOCS_CHARS = 100_000;

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
                        "The Javascript code to execute. Can be empty if you only need bash_setup and a custom command.",
                },
                environment: {
                    type: "string",
                    enum: ["node", "browser"],
                    description:
                        "Use 'node' for standard JS API execution, and 'browser' for Playwright UI testing (2GB RAM).",
                },
                dependencies: {
                    type: "array",
                    items: { type: "string" },
                    description:
                        "Array of exactly named NPM packages required (e.g. ['zod']).",
                },
                bash_setup: {
                    type: "string",
                    description:
                        "Optional bash script to run BEFORE everything else (e.g. for creating files, preparing frontend environment).",
                },
                command: {
                    type: "string",
                    description:
                        "Optional command to run instead of 'node run.js' (e.g. 'npx playwright test').",
                },
            },
            required: ["code", "environment", "dependencies"],
        },
    },
};
