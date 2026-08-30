import { encode } from "gpt-tokenizer";

export function countTokens(text: string): number {
    if (!text) return 0;
    try {
        return encode(text).length;
    } catch {
        return Math.ceil(text.length / 4);
    }
}

export function countMessageTokens(message: {
    content?: unknown;
    tool_calls?: unknown;
}): number {
    const content = typeof message.content === "string" ? message.content : "";
    const toolCalls = (message as any).tool_calls
        ? JSON.stringify((message as any).tool_calls)
        : "";
    return countTokens(content) + countTokens(toolCalls) + 4;
}
