export const RESULT_START = "___RESULT_START___";
export const RESULT_END = "___RESULT_END___";
export const HTTP_LOG_START = "___HTTP_LOG_START___";
export const HTTP_LOG_END = "___HTTP_LOG_END___";

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
                    'A module without one cannot receive the execution context and would run as a no-op. ' +
                    'FIX: keep the exact same logic but move your top-level statements inside ' +
                    'export default async (ctx) => { ... return { result, ctx }; } — this is required ' +
                    'for CLI/build/script libraries too (pass an explicit argv array instead of relying ' +
                    'on process.argv).',
            }));
            process.exit(1);
        }
        const runFunc = userModule.default;`
        : `const runFunc = typeof userModule.default === 'function' ? userModule.default : (ctx) => { /* no-op: top-level code already ran via import */ };`;
    return `
import fs from 'fs';
import http from 'node:http';
import https from 'node:https';
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
            __t: __start, // for undici dedupe; stripped before emitting
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

// HTTP traffic interceptor (node:http / node:https) — got, node-fetch@2, axios
// and most non-fetch clients issue requests via http.request rather than
// globalThis.fetch; without this their traffic is invisible to grounding, so a
// real API call (e.g. to host.docker.internal) is wrongly treated as "no call".
// The URL is logged synchronously (an attempted call grounds the run even if it
// errors); status/error are filled in via events on the returned request.
const __wrapNodeHttp = (mod, defaultProto) => {
    for (const __name of ['request', 'get']) {
        const __orig = mod[__name];
        if (typeof __orig !== 'function') continue;
        mod[__name] = function (...args) {
            const req = __orig.apply(this, args);
            try {
                let url = '';
                let method = 'GET';
                const a = args[0];
                if (typeof a === 'string' || a instanceof URL) {
                    url = String(a);
                    const o = (args[1] && typeof args[1] === 'object' && !(args[1] instanceof URL))
                        ? args[1] : {};
                    method = String(o.method || 'GET').toUpperCase();
                } else if (a && typeof a === 'object') {
                    method = String(a.method || 'GET').toUpperCase();
                    const proto = String(a.protocol || (defaultProto + ':')).replace(':', '');
                    const host = a.hostname || a.host || 'localhost';
                    const port = a.port ? (':' + a.port) : '';
                    const path = a.path || '/';
                    url = proto + '://' + host + port + path;
                }
                const __entry = {
                    method, url, requestBody: null, responseStatus: null,
                    responseBody: null, durationMs: null, error: null,
                };
                const __start = Date.now();
                req.on('response', (res) => {
                    __entry.responseStatus = res.statusCode;
                    __entry.durationMs = Date.now() - __start;
                });
                req.on('error', (e) => {
                    __entry.error = (e && e.message) || String(e);
                    __entry.durationMs = Date.now() - __start;
                });
                __httpLog.push(__entry);
            } catch {}
            return req;
        };
    }
};
try { __wrapNodeHttp(http, 'http'); __wrapNodeHttp(https, 'https'); } catch {}

// HTTP traffic interceptor (undici) — undici drives its own socket stack, so it
// bypasses BOTH globalThis.fetch and node:http. Without this its requests are
// invisible to grounding and every exit-0 run is rejected as "never called the
// API". undici publishes to node's diagnostics_channel, which is the supported
// observation point and covers all of its APIs (request/fetch/Client/Pool).
try {
    const dc = await import('node:diagnostics_channel');
    dc.subscribe('undici:request:create', (msg) => {
        try {
            const req = msg?.request; if (!req) return;
            const method = String(req.method || 'GET').toUpperCase();
            const url = String(req.origin || '') + String(req.path || '');
            // Node's global fetch is undici internally, so a patched-fetch call
            // also lands here. Skip it if fetch already logged the same request.
            const dup = __httpLog.some((e) =>
                e.url === url && e.method === method && Date.now() - (e.__t || 0) < 2000);
            if (dup) return;
            __httpLog.push({
                method, url, requestBody: null, responseStatus: null,
                responseBody: null, durationMs: null, error: null, __t: Date.now(),
            });
        } catch {}
    });
} catch { /* diagnostics_channel unavailable — other interceptors still apply */ }

;(async () => {
    const __emitHttpLog = () => {
        if (__httpLog.length > 0) {
            console.log("${HTTP_LOG_START}");
            // Drop the internal dedupe timestamp — it is not part of the report.
            console.log(JSON.stringify(__httpLog.map(({ __t, ...e }) => e)));
            console.log("${HTTP_LOG_END}");
        }
    };
    // Force process termination after emitting output. Stateful clients (ioredis,
    // mongoose, pg/mysql2 pools, redis v4) keep open sockets and retry timers that
    // hold the event loop alive, so a program that never calls .quit()/.end() would
    // otherwise hang until the sandbox timeout. We flush stdout/stderr first so the
    // result markers are not truncated, with a short hard fallback.
    const __exit = (code) => {
        let pending = 2;
        const done = () => { if (--pending <= 0) process.exit(code); };
        try { process.stdout.write('', done); } catch { done(); }
        try { process.stderr.write('', done); } catch { done(); }
        setTimeout(() => process.exit(code), 2000).unref();
    };
    try {
        const userModule = await import('./userStep.js');
        ${resolveRunFunc}
        const output = await runFunc(ctx);
        console.log("${RESULT_START}");
        console.log(JSON.stringify(output || { result: null, ctx }));
        console.log("${RESULT_END}");
        __emitHttpLog();
        __exit(0);
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
        __exit(1);
    }
})();
`;
}
