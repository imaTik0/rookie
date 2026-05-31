/**
 * Token counting via a real BPE tokenizer (gpt-tokenizer, o200k/cl100k family)
 * instead of the previous `chars / 4` heuristic. Used for context-budget
 * decisions in the agentic loop. The exact tokenizer of a local model (Qwen,
 * Gemma) differs, but a GPT-family count is a far better proxy than char/4 and
 * is good enough for budgeting. Falls back to the heuristic if encoding fails.
 */
import { encode } from "gpt-tokenizer";

export function countTokens(text: string): number {
    if (!text) return 0;
    try {
        return encode(text).length;
    } catch {
        return Math.ceil(text.length / 4);
    }
}

/** Approximate token count of a chat message (content + serialized tool calls). */
export function countMessageTokens(message: {
    content?: unknown;
    tool_calls?: unknown;
}): number {
    const content = typeof message.content === "string" ? message.content : "";
    const toolCalls = (message as any).tool_calls
        ? JSON.stringify((message as any).tool_calls)
        : "";
    // ~4 tokens of per-message framing overhead (role, delimiters).
    return countTokens(content) + countTokens(toolCalls) + 4;
}
