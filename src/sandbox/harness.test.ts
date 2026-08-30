/**
 * End-to-end test for the extracted sandbox harness. GATED on Docker.
 * Runs the real harness in a container so a regression in the (large) template
 * is actually caught — the fake-DockerExecutor tests cannot see harness output.
 * Run with: deno test --allow-all src/sandbox/harness.test.ts
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { DockerExecutor } from "../service/DockerExecutor.ts";
import {
    buildSandboxHarness,
    HTTP_LOG_END,
    HTTP_LOG_START,
    RESULT_END,
    RESULT_START,
} from "./harness.ts";
import { dockerAvailable } from "../testing/infra.ts";

const HAS_DOCKER = await dockerAvailable();

Deno.test(
    { name: "[docker] harness runs user code and emits RESULT markers", ignore: !HAS_DOCKER },
    async () => {
        const script = buildSandboxHarness(
            "export default async (ctx) => ({ result: ctx.n * 2, ctx });",
            { n: 21 },
        );
        const r = await new DockerExecutor({ timeoutMs: 20000 }).execute("node", script);
        assertStringIncludes(r.stdout, RESULT_START);
        assertStringIncludes(r.stdout, RESULT_END);
        const json = r.stdout.substring(
            r.stdout.indexOf(RESULT_START) + RESULT_START.length,
            r.stdout.indexOf(RESULT_END),
        ).trim();
        const parsed = JSON.parse(json);
        assert(parsed.result === 42, `expected result 42, got ${parsed.result}`);
    },
);

Deno.test({
    name: "[docker] harness exits non-zero and serialises a thrown error",
    ignore: !HAS_DOCKER,
}, async () => {
    const script = buildSandboxHarness(
        "export default async () => { throw new Error('boom from user code'); };",
        {},
    );
    const r = await new DockerExecutor({ timeoutMs: 20000 }).execute("node", script);
    assert(r.exitCode !== 0, "harness should exit non-zero on a thrown error");
    assertStringIncludes(r.stderr, "boom from user code");
});

Deno.test({
    name: "[docker] harness fails hard when the program has no default export",
    ignore: !HAS_DOCKER,
}, async () => {
    const script = buildSandboxHarness("console.log('top-level only');", {});
    const r = await new DockerExecutor({ timeoutMs: 20000 }).execute("node", script);
    assert(r.exitCode !== 0, "missing default export must not pass");
    assertStringIncludes(r.stderr, "ROOKIE_NO_DEFAULT_EXPORT");
});

Deno.test({
    // Regression guard: non-fetch clients (got, axios, …) issue requests via
    // node:http, not globalThis.fetch. If the harness only patched fetch, their
    // traffic would be invisible to grounding and every real API call wrongly
    // treated as "no call" (the got-experiment 0/0 bug).
    name: "[docker] harness captures node:http traffic (not just fetch)",
    ignore: !HAS_DOCKER,
}, async () => {
    const userCode = `
import http from 'node:http';
export default async () => {
    const server = http.createServer((req, res) => res.end('ok'));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const body = await new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:' + port + '/ping', (res) => {
            let d = '';
            res.on('data', (c) => d += c);
            res.on('end', () => resolve(d));
        }).on('error', reject);
    });
    server.close();
    return { result: body };
};`;
    const script = buildSandboxHarness(userCode, {});
    const r = await new DockerExecutor({ timeoutMs: 20000 }).execute("node", script);
    assertStringIncludes(r.stdout, HTTP_LOG_START);
    const log = JSON.parse(
        r.stdout.substring(
            r.stdout.indexOf(HTTP_LOG_START) + HTTP_LOG_START.length,
            r.stdout.indexOf(HTTP_LOG_END),
        ).trim(),
    ) as Array<{ url: string; method: string }>;
    assert(
        log.some((e) => e.url.includes("/ping")),
        `expected node:http request to be captured, got ${JSON.stringify(log)}`,
    );
});

Deno.test({
    name: "[docker] lenient mode (doc examples) still runs top-level code as a no-op module",
    ignore: !HAS_DOCKER,
}, async () => {
    const script = buildSandboxHarness(
        "console.log('doc example executed');",
        {},
        { requireDefaultExport: false },
    );
    const r = await new DockerExecutor({ timeoutMs: 20000 }).execute("node", script);
    assertEquals(r.exitCode, 0);
    assertStringIncludes(r.stdout, "doc example executed");
});

Deno.test({
    // Regression: undici drives its own socket stack, bypassing BOTH
    // globalThis.fetch and node:http. Its traffic was invisible to grounding, so
    // every undici run was rejected as "never called the API" (39/74 failing
    // steps on that target). node:diagnostics_channel is the supported hook.
    name: "[docker] harness captures undici traffic via diagnostics_channel",
    ignore: !HAS_DOCKER,
}, async () => {
    const userCode = `
import { request } from 'undici';
export default async () => {
    // Deliberately unreachable: an ATTEMPTED call must still be captured, since
    // a failed request is a real interaction with the API.
    try { await request('http://127.0.0.1:9/undici-probe'); } catch { /* expected */ }
    return { result: 'done' };
};`;
    const script = buildSandboxHarness(userCode, {});
    // networkAccess is required only to reach the npm registry for the install;
    // the probe itself targets an unreachable local port.
    const r = await new DockerExecutor({
        timeoutMs: 30000,
        installTimeoutMs: 180000,
        networkAccess: true,
    }).execute("node", script, { packages: ["undici@7.29.0"] });
    assertStringIncludes(r.stdout, HTTP_LOG_START);
    const log = JSON.parse(
        r.stdout.substring(
            r.stdout.indexOf(HTTP_LOG_START) + HTTP_LOG_START.length,
            r.stdout.indexOf(HTTP_LOG_END),
        ).trim(),
    ) as Array<{ url: string }>;
    assert(
        log.some((e) => e.url.includes("/undici-probe")),
        `expected undici request captured, got ${JSON.stringify(log)}`,
    );
});
