/**
 * The Node.js harness injected into the sandbox before user code runs.
 *
 * It writes the user's module to disk, monkey-patches `globalThis.fetch` to
 * capture every HTTP request, runs the user's default export with the current
 * context, and prints results/errors/HTTP-traffic wrapped in unambiguous markers
 * that the Executor parses back out of stdout.
 *
 * Extracted from Executor so the (substantial) harness logic lives in one place
 * and the orchestration code stays readable. Marker strings are shared constants
 * so the producer (here) and the parser (Executor) can never drift apart.
 */

export const RESULT_START = "___RESULT_START___";
export const RESULT_END = "___RESULT_END___";
export const HTTP_LOG_START = "___HTTP_LOG_START___";
export const HTTP_LOG_END = "___HTTP_LOG_END___";

/** Marker emitted when a program violates the export-default-function contract. */
export const NO_DEFAULT_EXPORT = "ROOKIE_NO_DEFAULT_EXPORT";

export interface HarnessOptions {
    /**
     * Whether the program must export a default function. Generated code is
     * contractually required to `export default async (ctx) => …` (the prompts
     * demand it, and ctx passing depends on it) — silently substituting a no-op
     * would let an empty program "pass". Documentation code examples are exempt:
     * they are top-level scripts whose import alone executes them.
     */
    requireDefaultExport?: boolean;
}

/** Build the Node harness script for a single sandbox step. */
export function buildSandboxHarness(
    userCode: string,
    ctx: unknown,
    opts: HarnessOptions = {},
): string {
    const requireDefaultExport = opts.requireDefaultExport ?? true;
    const resolveRunFunc = requireDefaultExport
        ? `if (typeof userModule.default !== 'function') {
            __emitHttpLog();
            console.error(JSON.stringify({
                name: 'HarnessContractError',
                message: '${NO_DEFAULT_EXPORT}: the program must export default an async function(ctx). ' +
                    'A module without one cannot receive the execution context and would run as a no-op.',
            }));
            process.exit(1);
        }
        const runFunc = userModule.default;`
        : `const runFunc = typeof userModule.default === 'function' ? userModule.default : (ctx) => { /* no-op: top-level code already ran via import */ };`;
    return `
import fs from 'fs';
const ctx = ${JSON.stringify(ctx)};
const userCode = ${JSON.stringify(userCode)};

fs.writeFileSync('./userStep.js', userCode);

// HTTP traffic interceptor — monkey-patches globalThis.fetch so all HTTP
// requests made by user code are captured for failure analysis.
const __httpLog = [];
const __origFetch = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
if (__origFetch) {
    globalThis.fetch = async (url, opts = {}) => {
        const __start = Date.now();
        const __entry = {
            method: (opts?.method || 'GET').toUpperCase(),
            url: String(url),
            requestBody: null,
            responseStatus: null,
            responseBody: null,
            durationMs: null,
            error: null,
        };
        if (opts?.body) {
            try { __entry.requestBody = typeof opts.body === 'string' ? opts.body.slice(0, 500) : JSON.stringify(opts.body).slice(0, 500); } catch {}
        }
        try {
            const __res = await __origFetch(url, opts);
            __entry.responseStatus = __res.status;
            __entry.durationMs = Date.now() - __start;
            try { const __clone = __res.clone(); __entry.responseBody = (await __clone.text()).slice(0, 1000); } catch {}
            __httpLog.push(__entry);
            return __res;
        } catch (__e) {
            __entry.error = __e.message ?? String(__e);
            __entry.durationMs = Date.now() - __start;
            __httpLog.push(__entry);
            throw __e;
        }
    };
}

;(async () => {
    const __emitHttpLog = () => {
        if (__httpLog.length > 0) {
            console.log("${HTTP_LOG_START}");
            console.log(JSON.stringify(__httpLog));
            console.log("${HTTP_LOG_END}");
        }
    };
    try {
        const userModule = await import('./userStep.js');
        ${resolveRunFunc}
        const output = await runFunc(ctx);
        console.log("${RESULT_START}");
        console.log(JSON.stringify(output || { result: null, ctx }));
        console.log("${RESULT_END}");
        __emitHttpLog();
    } catch (e) {
        __emitHttpLog();

        // Safe JSON serialiser — handles circular references (e.g. axios error objects
        // contain Socket→ClientRequest→socket cycles that blow up naive JSON.stringify).
        const __safeJson = (obj) => {
            const seen = new WeakSet();
            return JSON.stringify(obj, (key, value) => {
                if (typeof value === 'object' && value !== null) {
                    if (seen.has(value)) return '[Circular]';
                    seen.add(value);
                }
                // Drop Node.js internal socket/stream objects — they're never useful in a
                // failure report and are almost always the source of circular references.
                if (value && typeof value === 'object' &&
                    (value.constructor?.name === 'Socket' ||
                     value.constructor?.name === 'TLSSocket' ||
                     value.constructor?.name === 'ClientRequest' ||
                     value.constructor?.name === 'IncomingMessage')) {
                    return '[Stream]';
                }
                return value;
            });
        };

        let serializableError = {};

        // Axios errors: the most useful fields are in e.response and e.config.
        // The full error object has circular refs via e.request (Socket) — never copy it.
        if (e && (e.isAxiosError === true || (e.response && e.config))) {
            serializableError = {
                message: e.message,
                name: e.name || 'AxiosError',
                // HTTP response details — the primary signal for failure analysis
                status: e.response?.status ?? null,
                statusText: e.response?.statusText ?? null,
                responseData: e.response?.data ?? null,
                responseHeaders: e.response?.headers
                    ? Object.fromEntries(Object.entries(e.response.headers).slice(0, 10))
                    : null,
                // Request details — useful for identifying the wrong endpoint/method
                requestUrl: e.config?.url ?? null,
                requestMethod: e.config?.method?.toUpperCase() ?? null,
                requestBaseURL: e.config?.baseURL ?? null,
                // Stack for unexpected axios errors (e.g. network timeout)
                stack: e.stack?.split('\\n').slice(0, 6).join('\\n') ?? null,
            };
        } else if (e instanceof Error) {
            serializableError = {
                message: e.message,
                name: e.name,
                stack: e.stack?.split('\\n').slice(0, 8).join('\\n'),
                cause: e.cause instanceof Error ? e.cause.message : e.cause,
            };
            // Copy any additional plain-value own properties (e.g. e.code = 'ENOTFOUND')
            for (const key of Object.keys(e)) {
                if (!['request', 'response', 'config', 'socket'].includes(key)) {
                    try {
                        const val = (e)[key];
                        if (typeof val !== 'function' && typeof val !== 'object') {
                            serializableError[key] = val;
                        }
                    } catch {}
                }
            }
        } else if (typeof e === 'object' && e !== null) {
            serializableError = { message: String(e) };
        } else {
            serializableError = { message: String(e) };
        }

        try {
            console.error(__safeJson(serializableError));
        } catch {
            // Last-resort fallback if even the safe serialiser fails
            console.error(JSON.stringify({ message: String(e?.message ?? e), name: String(e?.name ?? 'Error') }));
        }
        process.exit(1);
    }
})();
`;
}
