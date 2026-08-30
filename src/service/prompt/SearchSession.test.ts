/**
 * Unit tests for the guarded search session (chunk dedup + repeated-query nudge).
 * Pure — no infra. Run with: deno test src/service/prompt/SearchSession.test.ts
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { createSearchSession } from "./SearchSession.ts";
import type * as types from "../../types/index.ts";

function chunk(
    id: string,
    content: string,
    fileName = "docs.md",
): types.vector.SearchResult<types.file.FileShard> {
    return {
        id,
        score: 0.9,
        payload: {
            content,
            metadata: { chunkId: 1, chunkSize: content.length, fileName, startPosition: 0 },
        },
    } as types.vector.SearchResult<types.file.FileShard>;
}

function session(resultsPerCall: types.vector.SearchResult<types.file.FileShard>[][]) {
    let call = 0;
    const queries: string[] = [];
    const s = createSearchSession({
        search: (q) => {
            queries.push(q);
            const r = resultsPerCall[Math.min(call, resultsPerCall.length - 1)];
            call++;
            return Promise.resolve(r);
        },
        maxResultChars: 100,
        logLabel: "Agent searching",
    });
    return { ...s, queries };
}

Deno.test("first search returns full content and counts everything as new", async () => {
    const { handler } = session([[chunk("c1", "how to authenticate with a token")]]);
    const out = await handler("id", { query: "authentication" });
    assertStringIncludes(out, "Found 1 result(s): 1 new, 0 previously retrieved.");
    assertStringIncludes(out, "how to authenticate with a token");
});

Deno.test("a chunk seen before is stubbed with a preview, not re-serialised", async () => {
    const long = "AUTH-DETAILS ".repeat(30); // > preview length
    const { handler } = session([[chunk("c1", long)]]);
    await handler("id", { query: "authentication header format" });
    const second = await handler("id", { query: "completely different topic entirely" });

    assertStringIncludes(second, "0 new, 1 previously retrieved");
    assertStringIncludes(second, "already returned earlier");
    // Full content must NOT be repeated — only the short preview.
    const contentOccurrences = second.split("AUTH-DETAILS").length - 1;
    assert(contentOccurrences * "AUTH-DETAILS ".length <= 200, "should only carry a preview");
});

Deno.test("zero new results triggers an explicit do-not-repeat steer", async () => {
    const { handler } = session([[chunk("c1", "same chunk")]]);
    await handler("id", { query: "influxdb concurrent queries runtime adjustment" });
    const out = await handler("id", {
        query: "influxdb concurrent queries runtime adjustment api",
    });

    assertStringIncludes(out, "NO NEW information");
    assertStringIncludes(out, "grep_corpus");
    // Near-identical query is called out by name.
    assertStringIncludes(out, "nearly identical");
    assertStringIncludes(out, "influxdb concurrent queries runtime adjustment");
});

Deno.test("a genuinely different query with fresh chunks is served normally", async () => {
    const { handler } = session([
        [chunk("c1", "alpha content")],
        [chunk("c1", "alpha content"), chunk("c2", "beta content about writes")],
    ]);
    await handler("id", { query: "alpha" });
    const out = await handler("id", { query: "how to write points to a bucket" });

    assertStringIncludes(out, "1 new, 1 previously retrieved");
    assertStringIncludes(out, "beta content about writes");
    assert(!out.includes("NO NEW information"));
});

Deno.test("empty results return guidance instead of a bare empty array", async () => {
    const { handler } = session([[]]);
    const out = await handler("id", { query: "nonexistent thing" });
    assertStringIncludes(out, "No results for this query");
    assertStringIncludes(out, "grep_corpus");
});

Deno.test("new-chunk content is truncated to maxResultChars", async () => {
    const { handler } = session([[chunk("c1", "X".repeat(500))]]);
    const out = await handler("id", { query: "big chunk" });
    const xRun = /X+/.exec(out)?.[0] ?? "";
    assertEquals(xRun.length, 100);
});
