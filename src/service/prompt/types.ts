/**
 * Types for the PromptService and its agentic pipeline.
 */

// ─── Public Response Types ───────────────────────────────────────────────────

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
        bash_setup?: string;
        command?: string;
    }[];
    finalMarkdownSummary: string;
}

export interface PromptOptions {
    minimalLength?: number;
    maximalLength?: number;
    userPreferences?: string;
    mandatoryImports?: string;
}

// ─── Tool Argument Types ─────────────────────────────────────────────────────

export interface SearchToolArgs {
    query: string;
    limit?: number;
}

export interface SmokeTestToolArgs {
    code: string;
    environment: "node" | "browser";
    dependencies: string[];
    bash_setup?: string;
    command?: string;
}

// ─── SmokeTest Callback ─────────────────────────────────────────────────────

export type SmokeTestCallback = (
    code: string,
    env: "node" | "browser",
    deps: string[],
    bash_setup?: string,
    command?: string,
) => Promise<string>;

// ─── Agentic Loop Types ─────────────────────────────────────────────────────

export type ToolHandler = (
    toolCallId: string,
    args: Record<string, any>,
) => Promise<string>;

export interface AgenticLoopConfig {
    messages: import("@openai/openai").default.Chat.ChatCompletionMessageParam[];
    tools: import("@openai/openai").default.Chat.ChatCompletionTool[];
    toolHandlers: Record<string, ToolHandler>;
    readySignal: string;
    maxIterations: number;
    phaseLabel: string;
}
