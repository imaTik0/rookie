import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
    type Bm25Params,
    DEFAULT_BM25_PARAMS,
    encodeDocument,
    encodeQuery,
    tokenId,
    tokenize,
} from "./Bm25.ts";

Deno.test("tokenId is deterministic and within unsigned-32-bit range", () => {
    assertEquals(tokenId("lodash"), tokenId("lodash"));
    assert(tokenId("lodash") !== tokenId("dayjs"));
    for (const t of ["", "a", "averylongtokenname", "@scope/pkg"]) {
        const id = tokenId(t);
        assert(id >= 0 && id <= 0xffffffff, `${t} -> ${id} out of u32 range`);
        assert(Number.isInteger(id));
    }
});

Deno.test("tokenize lowercases, splits, drops stopwords and 1-char tokens", () => {
    assertEquals(tokenize("The Quick brown_fox a x"), ["quick", "brown_fox"]);
});

Deno.test("tokenize can keep stopwords when asked", () => {
    assertEquals(tokenize("the quick", false), ["the", "quick"]);
});

Deno.test("encodeDocument produces one BM25-saturated weight per unique token", () => {
    const v = encodeDocument("alpha alpha beta");
    assertEquals(v.indices.length, 2);
    assertEquals(v.values.length, 2);

    const byId = new Map(v.indices.map((id, i) => [id, v.values[i]]));
    const alpha = byId.get(tokenId("alpha"))!;
    const beta = byId.get(tokenId("beta"))!;

    assertAlmostEquals(alpha, 2.0936480, 1e-4);
    assertAlmostEquals(beta, 1.8009145, 1e-4);

    assert(alpha > beta);
    assert(alpha < 2 * beta);
});

Deno.test("encodeDocument: longer documents get lower per-term weights (length norm)", () => {
    const short = encodeDocument("alpha beta");
    const padded = "alpha " + Array(50).fill("filler").join(" ") + " beta";
    const long = encodeDocument(padded);
    const wShort = short.values[short.indices.indexOf(tokenId("alpha"))];
    const wLong = long.values[long.indices.indexOf(tokenId("alpha"))];
    assert(wLong < wShort, "term weight should drop as the document lengthens");
});

Deno.test("encodeQuery is presence-only (all values 1.0)", () => {
    const q = encodeQuery("alpha alpha beta");
    assertEquals(q.indices.length, 2);
    assertEquals(q.values, [1.0, 1.0]);
});

Deno.test("same token maps to same sparse dimension across documents", () => {
    const a = encodeDocument("shared token here");
    const b = encodeDocument("a completely shared sentence");
    assert(a.indices.includes(tokenId("shared")));
    assert(b.indices.includes(tokenId("shared")));
});

Deno.test("DEFAULT_BM25_PARAMS are the documented defaults", () => {
    const expected: Bm25Params = { k1: 1.5, b: 0.75, avgLen: 256 };
    assertEquals(DEFAULT_BM25_PARAMS, expected);
});
