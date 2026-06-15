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
                    description: "The Javascript code to execute.",
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
                pattern: {
                    type: "string",
                    description: "The string or regex pattern to search for",
                },
            },
            required: ["filename", "pattern"],
        },
    },
};

export const GREP_CORPUS_TOOL: OpenAI.Chat.ChatCompletionTool = {
    type: "function",
    function: {
        name: "grep_corpus",
        description:
            "Search for a pattern across ALL project files at once. Returns matching lines with filename, line number, and surrounding context. Prefer this over calling grep_file on each file individually.",
        parameters: {
            type: "object",
            properties: {
                pattern: {
                    type: "string",
                    description: "Regex or literal string to search (case-insensitive)",
                },
                context_lines: {
                    type: "number",
                    description: "Lines of context before/after each match (default 2)",
                    default: 2,
                },
            },
            required: ["pattern"],
        },
    },
};

export const OUTLINE_FILE_TOOL: OpenAI.Chat.ChatCompletionTool = {
    type: "function",
    function: {
        name: "outline_file",
        description:
            "Get the structural outline of a file: markdown headings with line numbers, or OpenAPI endpoint paths with HTTP methods. Use this to navigate large files before reading specific sections.",
        parameters: {
            type: "object",
            properties: {
                filename: { type: "string", description: "The file to outline" },
            },
            required: ["filename"],
        },
    },
};

export const READ_SECTION_TOOL: OpenAI.Chat.ChatCompletionTool = {
    type: "function",
    function: {
        name: "read_section",
        description:
            "Read a specific section from a file by matching its heading. Returns from the matched heading through all content until the next heading of equal or higher level. Far more token-efficient than read_file for large docs.",
        parameters: {
            type: "object",
            properties: {
                filename: { type: "string" },
                heading: {
                    type: "string",
                    description: "Partial or full heading text to match (case-insensitive)",
                },
            },
            required: ["filename", "heading"],
        },
    },
};

export const GET_ENDPOINT_TOOL: OpenAI.Chat.ChatCompletionTool = {
    type: "function",
    function: {
        name: "get_endpoint",
        description:
            "Look up a specific API endpoint from OpenAPI/Swagger JSON specs by HTTP method and path. Returns the full endpoint definition including parameters, request body, and responses.",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "API path to look up (e.g. /users/{id} or partial match)",
                },
                method: {
                    type: "string",
                    description:
                        "HTTP method (GET, POST, PUT, DELETE, PATCH). Omit to return all methods for the path.",
                },
            },
            required: ["path"],
        },
    },
};
