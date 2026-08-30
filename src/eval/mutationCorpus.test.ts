import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { POST_CUTOFF_CORPORA } from "./mutationCorpus.ts";

Deno.test("every post-cutoff corpus is well-formed and pins a 2026 version", () => {
    for (const [key, s] of Object.entries(POST_CUTOFF_CORPORA)) {
        assert(s.pkg.length > 0, `${key}: pkg`);
        assert(/^\d+\.\d+\.\d+$/.test(s.version), `${key}: semver ${s.version}`);
        assert(s.docFiles.length >= 1, `${key}: has doc files`);
        assert(s.maxGoals >= 1, `${key}: maxGoals`);
        assertStringIncludes(s.docBaseUrl, "raw.githubusercontent.com");
        assert(s.docBaseUrl.endsWith("/"), `${key}: docBaseUrl must end with '/'`);
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
    const m = POST_CUTOFF_CORPORA.marked;
    assert(m, "marked corpus must exist");
    assert(m.version.startsWith("18."), `expected marked@18, got ${m.version}`);
    assertEquals(m.pkg, "marked");
    assert(m.pure, "corpus must run without external services");
    assert(m.docFiles.length <= 4, "a narrow doc set keeps goals on the main API");
});
