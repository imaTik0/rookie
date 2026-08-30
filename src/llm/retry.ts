export interface RetryLogger {
    log: (...args: any[]) => void;
    error: (...args: any[]) => void;
}

export interface RetryOptions {
    retries: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    label?: string;
    logger?: RetryLogger;
}

export const EMPTY_COMPLETION = "empty completion";

export function isRetryableError(err: unknown): boolean {
    const e = err as any;
    const status = e?.status ?? e?.response?.status ?? e?.code;
    if (status === 429 || status === 408) return true;
    if (typeof status === "number" && status >= 500 && status < 600) return true;
    const msg = String(e?.message ?? e ?? "").toLowerCase();
    return /econnreset|etimedout|econnrefused|enotfound|fetch failed|network|socket|timeout|temporarily|overloaded|rate limit|empty completion/
        .test(msg);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
    const base = opts.baseDelayMs ?? 500;
    const max = opts.maxDelayMs ?? 15_000;
    let attempt = 0;

    while (true) {
        try {
            return await fn();
        } catch (err) {
            attempt++;
            if (attempt > opts.retries || !isRetryableError(err)) throw err;
            const backoff = Math.min(max, base * 2 ** (attempt - 1));
            const jitter = Math.floor(Math.random() * Math.min(base, backoff));
            const delay = backoff + jitter;
            opts.logger?.error(
                `${opts.label || "LLM call"} failed (attempt ${attempt}/${opts.retries}); ` +
                    `retrying in ${delay}ms: ${(err as Error)?.message ?? err}`,
            );
            await sleep(delay);
        }
    }
}
