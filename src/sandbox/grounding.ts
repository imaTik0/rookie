/**
 * Grounded-success enforcement for sandbox executions.
 *
 * A step that exits 0 without ever touching the documented API proves nothing
 * about the documentation: the agent may have mocked the server, or the harness
 * may have run a no-op. When the execution context declares API base URLs
 * (e.g. `apiBase`, `baseUrl` in initialContext), a "success" is only accepted
 * if the captured HTTP traffic contains at least one request to one of those
 * hosts. Failed requests count too — an attempted real call (e.g. ECONNREFUSED,
 * 401) is a genuine interaction with the API; only the *absence* of any attempt
 * is disqualifying.
 *
 * Pure and dependency-free — unit-tested in grounding.test.ts.
 */
import type * as types from "../types/index.ts";

/** Marker prefixed to the synthetic error when an exit-0 run never called the API. */
export const UNGROUNDED_SUCCESS = "ROOKIE_UNGROUNDED_SUCCESS";

const MAX_WALK_DEPTH = 5;

/**
 * Collect the hostnames of every http(s) URL found in the execution context
 * (deep walk over string values). An empty set means the context declares no
 * API endpoint — e.g. library testing — and grounding is not enforced.
 */
export function extractApiHosts(ctx: unknown): Set<string> {
    const hosts = new Set<string>();
    const seen = new WeakSet<object>();

    const visit = (value: unknown, depth: number): void => {
        if (depth > MAX_WALK_DEPTH) return;
        if (typeof value === "string") {
            // Cheap pre-filter before URL parsing.
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

/**
 * True when the execution is grounded: either no API hosts are declared
 * (nothing to enforce), or at least one captured HTTP request targeted a
 * declared host. Hostnames are compared without ports — a call to the right
 * box on a wrong port is still a real interaction attempt (and its failure
 * will surface through the normal error path).
 */
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

/** Build the synthetic error message for an ungrounded exit-0 execution. */
export function ungroundedSuccessError(declaredHosts: Set<string>): string {
    return `${UNGROUNDED_SUCCESS}: the program exited successfully but never made an HTTP ` +
        `request to the documented API (expected host(s): ${[...declaredHosts].join(", ")}). ` +
        `A success that does not exercise the real API proves nothing about the documentation — ` +
        `do not mock or simulate the server; make real HTTP requests using the provided context.`;
}
