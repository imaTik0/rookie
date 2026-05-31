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
}

export type SmokeTestCallback = (
    code: string,
) => Promise<string>;

export interface ReadFileArgs { filename: string; }
export interface HeadFileArgs { filename: string; lines: number; }
export interface TailFileArgs { filename: string; lines: number; }
export interface GrepFileArgs { filename: string; pattern: string; }

export interface RouterPlanResponse {
    steps: {
        stepExplanation: string;
        action: string;
    }[];
}

// ─── Agentic Loop Types ─────────────────────────────────────────────────────

export type ToolHandler = (
    toolCallId: string,
    args: Record<string, any>,
) => Promise<string>;

export interface AgenticLoopConfig {
    modelName: string;
    messages: import("@openai/openai").default.Chat.ChatCompletionMessageParam[];
    tools: import("@openai/openai").default.Chat.ChatCompletionTool[];
    toolHandlers: Record<string, ToolHandler>;
    readySignal: string;
    maxIterations: number;
    phaseLabel: string;
    onTrace?: (event: import("../../types/index.ts").trace.TraceEvent) => Promise<void>;
    maxContextChars?: number;
}
