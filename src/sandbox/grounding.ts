import type * as types from "../types/index.ts";

export const UNGROUNDED_SUCCESS = "ROOKIE_UNGROUNDED_SUCCESS";

const MAX_WALK_DEPTH = 5;

export function extractApiHosts(ctx: unknown): Set<string> {
    const hosts = new Set<string>();
    const seen = new WeakSet<object>();

    const visit = (value: unknown, depth: number): void => {
        if (depth > MAX_WALK_DEPTH) return;
        if (typeof value === "string") {
            if (!value.startsWith("http://") && !value.startsWith("https://")) return;
            try {
                hosts.add(new URL(value).hostname);
            } catch { /* not a URL */ }
            return;
        }
        if (value !== null && typeof value === "object") {
            if (seen.has(value)) return;
            seen.add(value);
            const entries = Array.isArray(value) ? value : Object.values(value);
            for (const v of entries) visit(v, depth + 1);
        }
    };

    visit(ctx, 0);
    return hosts;
}

export function isGrounded(
    declaredHosts: Set<string>,
    traffic: types.report.HttpTrafficEntry[] | undefined,
): boolean {
    if (declaredHosts.size === 0) return true;
    if (!traffic || traffic.length === 0) return false;
    return traffic.some((entry) => {
        try {
            return declaredHosts.has(new URL(entry.url).hostname);
        } catch {
            return false;
        }
    });
}

export function ungroundedSuccessError(declaredHosts: Set<string>): string {
    return `${UNGROUNDED_SUCCESS}: the program exited successfully but never made an HTTP ` +
        `request to the documented API (expected host(s): ${[...declaredHosts].join(", ")}). ` +
        `A success that does not exercise the real API proves nothing about the documentation — ` +
        `do not mock or simulate the server; make real HTTP requests using the provided context.`;
}
