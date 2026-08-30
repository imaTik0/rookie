/**
 * Unit tests for the post-cutoff mutation corpora specs. Pure — no network
 * (the fetch itself is exercised only in a live run). Run with:
 *   deno test src/eval/mutationCorpus.test.ts
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { POST_CUTOFF_CORPORA } from "./mutationCorpus.ts";

Deno.test("every post-cutoff corpus is well-formed and pins a 2026 version", () => {
    for (const [key, s] of Object.entries(POST_CUTOFF_CORPORA)) {
        assert(s.pkg.length > 0, `${key}: pkg`);
        assert(/^\d+\.\d+\.\d+$/.test(s.version), `${key}: semver ${s.version}`);
        // Post-cutoff sample: the pinned majors are the 2026 releases.
        assert(s.docFiles.length >= 1, `${key}: has doc files`);
        assert(s.maxGoals >= 1, `${key}: maxGoals`);
        assertStringIncludes(s.docBaseUrl, "raw.githubusercontent.com");
        // docBaseUrl is a directory (used as prefix), so it must end with '/'.
        assert(s.docBaseUrl.endsWith("/"), `${key}: docBaseUrl must end with '/'`);
        // The tag in the URL should carry the pinned version.
        assert(
            s.docBaseUrl.includes(s.version),
            `${key}: docBaseUrl should pin version ${s.version}`,
        );
    }
});

Deno.test("execa corpus targets execa@10 (post-cutoff) with rich docs", () => {
    const e = POST_CUTOFF_CORPORA.execa;
    assert(e.version.startsWith("10."));
    assert(e.docFiles.includes("api.md"));
    assert(e.docFiles.length >= 10, "full docs, not just README");
});

Deno.test("the ACTIVE corpus is marked@18 (attainable gold standard)", () => {
    // execa@10 was demoted after failing the ≥90% gold standard at 48% (steps):
    // its 16 doc files steer goal generation into exotic corners of the API that
    // the agent fails even on pristine docs. marked's surface is a call plus an
    // options object, and the drift study measured a 90% baseline for it.
    const m = POST_CUTOFF_CORPORA.marked;
    assert(m, "marked corpus must exist");
    assert(m.version.startsWith("18."), `expected marked@18, got ${m.version}`);
    assertEquals(m.pkg, "marked");
    assert(m.pure, "corpus must run without external services");
    // Keep the pool tractable: a full run costs one agent session per mutant.
    assert(m.docFiles.length <= 4, "a narrow doc set keeps goals on the main API");
});
