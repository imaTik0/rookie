import { assertEquals } from "@std/assert";
import { PromptService } from "./PromptService.ts";
import { ConfigService } from "./ConfigService.ts";
import { fakeEmbeddingService, fakeLogger, fakeOpenAI } from "../testing/fakes.ts";
import type OpenAI from "@openai/openai";

function ps(opts: { openai?: OpenAI; config?: ConfigService } = {}) {
    const openai = opts.openai ?? fakeOpenAI([{ content: "{}" }]).openai;
    const config = opts.config ?? new ConfigService(fakeLogger());
    return new PromptService(
        openai,
        fakeLogger(),
        fakeEmbeddingService(),
        null as never,
        config,
        null as never,
    );
}

Deno.test("classifyFailure delegates to FailureClassifier (majority vote)", async () => {
    const { openai } = fakeOpenAI([{ content: JSON.stringify({ documentationGap: "INCORRECT" }) }]);
    const a = await ps({ openai }).classifyFailure("err", "code", "docs", "desc");
    assertEquals(a.documentationGap, "INCORRECT");
    assertEquals(a.votes, 3);
});

Deno.test("refineSearchQuery delegates to FailureClassifier", async () => {
    const { openai } = fakeOpenAI([{ content: "refined" }]);
    assertEquals(await ps({ openai }).refineSearchQuery("e", "c"), "refined");
});

Deno.test("rerankSearchResults delegates to RagSearch ('off' mode slices)", async () => {
    const config = { values: { reranker: { mode: "off" } } } as unknown as ConfigService;
    // deno-lint-ignore no-explicit-any
    const results = Array.from(
        { length: 4 },
        (_, i) => ({ score: i, payload: { content: `c${i}` } }),
    ) as any;
    assertEquals((await ps({ config }).rerankSearchResults("q", results, 2)).length, 2);
});

Deno.test("extractGapAnalysisFromBounce takes the prose before NEEDS_RESEARCH", () => {
    // deno-lint-ignore no-explicit-any
    const p = ps() as any;
    const content =
        "The docs never describe the auth header format anywhere.\n\nNEEDS_RESEARCH: auth header";
    assertEquals(
        p.extractGapAnalysisFromBounce(content),
        "The docs never describe the auth header format anywhere.",
    );
});

Deno.test("extractGapAnalysisFromBounce returns undefined for trivial prefixes", () => {
    // deno-lint-ignore no-explicit-any
    const p = ps() as any;
    assertEquals(p.extractGapAnalysisFromBounce("NEEDS_RESEARCH: x"), undefined);
    assertEquals(p.extractGapAnalysisFromBounce("short\nNEEDS_RESEARCH: x"), undefined);
});
