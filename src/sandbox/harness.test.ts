/**
 * End-to-end test for the extracted sandbox harness. GATED on Docker.
 * Runs the real harness in a container so a regression in the (large) template
 * is actually caught — the fake-DockerExecutor tests cannot see harness output.
 * Run with: deno test --allow-all src/sandbox/harness.test.ts
 */
import { assert, assertStringIncludes } from "@std/assert";
import { DockerExecutor } from "../service/DockerExecutor.ts";
import { buildSandboxHarness, RESULT_END, RESULT_START } from "./harness.ts";
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
