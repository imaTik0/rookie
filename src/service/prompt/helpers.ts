/**
 * Progress-event helpers for the Agentic RAG pipeline.
 *
 * Every event is a JSON string `{ type, ... }` passed to `onProgress`. The
 * planner forwards these verbatim (as `GOAL_PROGRESS.log`) so clients can render
 * a live, structured view of the agent working:
 *   - `phase`         — a new phase/iteration started
 *   - `token`         — a streamed content delta of the current assistant message
 *   - `assistant_end` — the assistant message finished (collapse the token stream)
 *   - `tool_call`     — the agent invoked a tool (name + args)
 *   - `tool_result`   — a tool returned (name + short preview)
 *   - `log`           — misc status line
 */

export type ProgressCallback = ((msg: string) => void) | undefined;

export function emitLog(onProgress: ProgressCallback, message: string): void {
    onProgress?.(JSON.stringify({ type: "log", content: message }));
}

export function emitPhase(onProgress: ProgressCallback, label: string): void {
    onProgress?.(JSON.stringify({ type: "phase", content: label }));
}

export function emitToken(onProgress: ProgressCallback, token: string): void {
    onProgress?.(JSON.stringify({ type: "token", content: token }));
}

export function emitAssistantEnd(onProgress: ProgressCallback, content: string): void {
    onProgress?.(JSON.stringify({ type: "assistant_end", content }));
}

export function emitToolCall(
    onProgress: ProgressCallback,
    name: string,
    args: Record<string, unknown>,
): void {
    onProgress?.(JSON.stringify({ type: "tool_call", name, args }));
}

export function emitToolResult(
    onProgress: ProgressCallback,
    name: string,
    preview: string,
): void {
    onProgress?.(JSON.stringify({ type: "tool_result", name, preview: preview.slice(0, 280) }));
}
