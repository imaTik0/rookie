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
