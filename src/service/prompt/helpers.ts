/**
 * SSE streaming helper utilities for the Agentic RAG pipeline.
 */

export type ProgressCallback = ((msg: string) => void) | undefined;

export function emitLog(onProgress: ProgressCallback, message: string): void {
    onProgress?.(JSON.stringify({ type: "log", content: message }));
}

export function emitToken(onProgress: ProgressCallback, token: string): void {
    onProgress?.(JSON.stringify({ type: "token", content: token }));
}
