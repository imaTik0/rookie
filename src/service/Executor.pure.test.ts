/**
 * Characterization tests for Executor's pure logic: status rollup, initial-context
 * parsing, the CONFIG-vs-ENVIRONMENT classifier, and HTTP-log marker parsing.
 *
 * These reach private methods via `as any` deliberately — they pin current
 * behaviour ahead of the planned extraction of this logic into pure modules.
 * Run with: deno test src/service/Executor.pure.test.ts
 */
import { assert, assertEquals } from "@std/assert";
import { Executor } from "./Executor.ts";
import type { ConfigService } from "./ConfigService.ts";
import type { CorpusFile } from "../feedback/fragmentVerify.ts";
import { fakeLogger } from "../testing/fakes.ts";

// Offline sandbox config so the constructor builds a DockerExecutor without a network name.
const cfg = {
    values: {
        sandbox: {
            networkMode: "none",
            stepTimeoutMs: 1000,
            hardening: true,
            user: "",
            pidsLimit: 256,
            networkName: "rookie-network",
        },
    },
} as unknown as ConfigService;

// deno-lint-ignore no-explicit-any
function executor(): any {
    return new Executor(
        null as never,
        null as never,
        null as never,
        null as never,
        fakeLogger(),
        null as never,
        null as never,
        null as never,
        cfg,
    );
}

// ── overallStatus ──────────────────────────────────────────────────────────────

Deno.test("overallStatus: all passed -> SUCCESS", () => {
    assertEquals(
        executor().overallStatus([{ status: "SUCCESS" }, { status: "SUCCESS" }]),
        "SUCCESS",
    );
});
Deno.test("overallStatus: all failed -> FAILED", () => {
    assertEquals(executor().overallStatus([{ status: "FAILED" }, { status: "FAILED" }]), "FAILED");
});
Deno.test("overallStatus: mixed -> PARTIAL_FAILURE", () => {
    assertEquals(
        executor().overallStatus([{ status: "SUCCESS" }, { status: "FAILED" }]),
        "PARTIAL_FAILURE",
    );
});
Deno.test("overallStatus: no steps -> SUCCESS (zero failures)", () => {
    assertEquals(executor().overallStatus([]), "SUCCESS");
});

// ── parseInitialContext ─────────────────────────────────────────────────────────

Deno.test("parseInitialContext parses valid JSON", () => {
    assertEquals(executor().parseInitialContext('{"token":"abc"}'), { token: "abc" });
});
Deno.test("parseInitialContext falls back to {} on invalid JSON", () => {
    assertEquals(executor().parseInitialContext("not json"), {});
});

// ── classifyEnvironmentError ─────────────────────────────────────────────────────

Deno.test("classifyEnvironmentError: module mentioned, no install context -> CONFIG", () => {
    const corpus: CorpusFile[] = [{
        filename: "docs.md",
        content: "The dayjs library handles dates nicely.",
    }];
    const a = executor().classifyEnvironmentError("Cannot find module 'dayjs'", corpus);
    assertEquals(a.documentationGap, "CONFIG");
    assert(String(a.reasoning).includes("no install instructions"));
    assertEquals(a.failedFunction, 'import("dayjs")');
    assertEquals(a.fragmentVerification.verified, true);
});

Deno.test("classifyEnvironmentError: module mentioned with install context -> CONFIG (incomplete)", () => {
    const corpus: CorpusFile[] = [{
        filename: "docs.md",
        content: "Setup:\nnpm install dayjs\nThen use it.",
    }];
    const a = executor().classifyEnvironmentError("Cannot find module 'dayjs'", corpus);
    assertEquals(a.documentationGap, "CONFIG");
    assert(String(a.reasoning).includes("incomplete or incorrect"));
});

Deno.test("classifyEnvironmentError: module not mentioned -> ENVIRONMENT", () => {
    const corpus: CorpusFile[] = [{ filename: "docs.md", content: "Nothing relevant here." }];
    const a = executor().classifyEnvironmentError("Cannot find module 'leftpad'", corpus);
    assertEquals(a.documentationGap, "ENVIRONMENT");
});

Deno.test("classifyEnvironmentError: non-module error -> ENVIRONMENT", () => {
    const a = executor().classifyEnvironmentError("ENOSPC: no space left on device", []);
    assertEquals(a.documentationGap, "ENVIRONMENT");
});

// ── parseHttpLog ─────────────────────────────────────────────────────────────────

Deno.test("parseHttpLog extracts the JSON array between markers", () => {
    const entries = [{ method: "GET", url: "http://x", responseStatus: 200 }];
    const stdout = `noise\n___HTTP_LOG_START___\n${
        JSON.stringify(entries)
    }\n___HTTP_LOG_END___\nmore`;
    assertEquals(executor().parseHttpLog(stdout), entries);
});
Deno.test("parseHttpLog returns undefined without markers", () => {
    assertEquals(executor().parseHttpLog("just some stdout"), undefined);
});
Deno.test("parseHttpLog returns undefined on malformed JSON", () => {
    assertEquals(
        executor().parseHttpLog("___HTTP_LOG_START___\n{bad json\n___HTTP_LOG_END___"),
        undefined,
    );
});
