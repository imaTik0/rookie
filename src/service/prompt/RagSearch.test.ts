/**
 * Unit tests for RagSearch (relocated from PromptService): cosine similarity,
 * relevance-aware truncation, and off-mode rerank. Assertions match the pre-split
 * characterization tests. Run with: deno test --allow-env src/service/prompt/RagSearch.test.ts
 */
import { assert, assertEquals } from "@std/assert";
import { RagSearch } from "./RagSearch.ts";
import { ConfigService } from "../ConfigService.ts";
import { fakeEmbeddingService, fakeLogger } from "../../testing/fakes.ts";
import type OpenAI from "@openai/openai";

function ragSearch(opts: { config?: ConfigService; embed?: (t: string[]) => number[][] } = {}) {
    const config = opts.config ?? new ConfigService(fakeLogger());
    return new RagSearch(
        {} as OpenAI,
        fakeEmbeddingService(opts.embed),
        null as never, // vectorCollectionFactory — unused by the methods tested here
        config,
        fakeLogger(),
    );
}

Deno.test("rerank in 'off' mode just slices to the limit", async () => {
    const config = { values: { reranker: { mode: "off" } } } as unknown as ConfigService;
    // deno-lint-ignore no-explicit-any
    const results = Array.from(
        { length: 5 },
        (_, i) => ({ score: i, payload: { content: `c${i}` } }),
    ) as any;
    const out = await ragSearch({ config }).rerank("q", results, 2);
    assertEquals(out.length, 2);
});

Deno.test("formatResults renders DOCUMENT markers with scores", () => {
    // deno-lint-ignore no-explicit-any
    const results = [{ score: 0.9, payload: { content: "hello docs" } }] as any;
    const out = ragSearch().formatResults(results);
    assert(out.includes("--- DOCUMENT 1 (Score: 0.9) ---"));
    assert(out.includes("hello docs"));
});

Deno.test("cosineSimilarity: identical vectors = 1, orthogonal = 0", () => {
    // deno-lint-ignore no-explicit-any
    const rs = ragSearch() as any;
    assertEquals(rs.cosineSimilarity([1, 0], [1, 0]), 1);
    assertEquals(rs.cosineSimilarity([1, 0], [0, 1]), 0);
});

Deno.test("rankAndFilterDocs returns content unchanged when under the cap", async () => {
    const content = "short content";
    assertEquals(await ragSearch().rankAndFilterDocs(content, "q", 1000), content);
});

Deno.test("rankAndFilterDocs packs DOCUMENT chunks greedily within the cap", async () => {
    const content = "--- DOCUMENT 1 (Score: 1) ---\n" + "A".repeat(40) +
        "\n--- DOCUMENT 2 (Score: 1) ---\n" + "B".repeat(40);
    const out = await ragSearch().rankAndFilterDocs(content, "q", 50);
    assert(out.length <= 50);
    assert(out.includes("A".repeat(40))); // first chunk fits
    assert(!out.includes("B".repeat(40))); // second exceeds the budget
});
