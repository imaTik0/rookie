import OpenAI from "@openai/openai";


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
                        "The Javascript code to execute.",
                },
            },
            required: ["code"],
        },
    },
};

export const LIST_FILES_TOOL: OpenAI.Chat.ChatCompletionTool = {
    type: "function",
    function: {
        name: "list_files",
        description: "List all files available in the project context.",
        parameters: { type: "object", properties: {} },
    },
};

export const READ_FILE_TOOL: OpenAI.Chat.ChatCompletionTool = {
    type: "function",
    function: {
        name: "read_file",
        description: "Read the entire content of a specific file.",
        parameters: {
            type: "object",
            properties: {
                filename: { type: "string", description: "The name of the file to read" },
            },
            required: ["filename"],
        },
    },
};

export const HEAD_FILE_TOOL: OpenAI.Chat.ChatCompletionTool = {
    type: "function",
    function: {
        name: "head_file",
        description: "Read the first N lines of a file.",
        parameters: {
            type: "object",
            properties: {
                filename: { type: "string" },
                lines: { type: "number", description: "Number of lines to read", default: 50 },
            },
            required: ["filename"],
        },
    },
};

export const TAIL_FILE_TOOL: OpenAI.Chat.ChatCompletionTool = {
    type: "function",
    function: {
        name: "tail_file",
        description: "Read the last N lines of a file.",
        parameters: {
            type: "object",
            properties: {
                filename: { type: "string" },
                lines: { type: "number", description: "Number of lines to read", default: 50 },
            },
            required: ["filename"],
        },
    },
};

export const GREP_FILE_TOOL: OpenAI.Chat.ChatCompletionTool = {
    type: "function",
    function: {
        name: "grep_file",
        description: "Search for a specific string or pattern inside a file.",
        parameters: {
            type: "object",
            properties: {
                filename: { type: "string" },
                pattern: { type: "string", description: "The string or regex pattern to search for" },
            },
            required: ["filename", "pattern"],
        },
    },
};
