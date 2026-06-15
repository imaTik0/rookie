/**
 * Unit tests for structure-aware chunking. Pure — no infra.
 * Run with: deno test src/service/FileHelpers.test.ts
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { FileHelpers } from "./FileHelpers.ts";
import type { ConfigService } from "./ConfigService.ts";
import type * as db from "../db/mongo/Model.ts";

const cfg = {
    values: { chunking: { chunkSize: 1200, chunkOverlap: 150 } },
} as unknown as ConfigService;

function helpers() {
    return new FileHelpers(cfg);
}

function file(filename: string, mimetype: string, content: string): db.File {
    return {
        _id: "file-1",
        filename,
        mimetype,
        data: new TextEncoder().encode(content),
    } as unknown as db.File;
}

Deno.test("chunkDbFile rejects non-text MIME types", () => {
    assertThrows(
        () => helpers().chunkDbFile(file("logo.png", "image/png", "...")),
        Error,
        "not chunkable",
    );
});

Deno.test("a small markdown file yields a single chunk", () => {
    const shards = helpers().chunkDbFile(file("a.md", "text/markdown", "# Title\n\nHello world."));
    assertEquals(shards.length, 1);
    assert(shards[0].content.includes("Hello world."));
    assertEquals(shards[0].metadata.totalChunks, 1);
});

Deno.test("heading boundaries split chunks and set section + line number", () => {
    const md = "# Alpha\nfirst section body\n# Beta\nsecond section body";
    const shards = helpers().chunkDbFile(file("doc.md", "text/markdown", md));
    assertEquals(shards.length, 2);
    assertEquals(shards[0].metadata.section, "# Alpha");
    assertEquals(shards[0].metadata.lineNumber, 1);
    assertEquals(shards[1].metadata.section, "# Beta");
    assertEquals(shards[1].metadata.lineNumber, 3);
});

Deno.test("fenced code blocks are never split mid-fence", () => {
    const md = [
        "# Code",
        "intro",
        "```js",
        "const a = 1; const b = 2; const c = 3; const d = 4; const e = 5;",
        "```",
        "after",
    ].join("\n");
    // Tiny chunkSize would normally split, but a fence must stay intact.
    const shards = helpers().chunkDbFile(file("c.md", "text/markdown", md), {
        chunkSize: 30,
        chunkOverlap: 0,
    });
    const codeChunk = shards.find((s) => s.content.includes("const a = 1"))!;
    assert(codeChunk, "expected a chunk containing the code");
    // The same chunk holds both fences and the whole code line — not split.
    assert(codeChunk.content.includes("```js"));
    assert(codeChunk.content.includes("const e = 5;"));
});

Deno.test("OpenAPI JSON is chunked one chunk per path+method", () => {
    const spec = JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Demo API" },
        paths: {
            "/users": {
                get: { summary: "List users", operationId: "listUsers" },
                post: { summary: "Create user" },
            },
        },
    });
    const shards = helpers().chunkDbFile(file("spec.json", "application/json", spec));
    assertEquals(shards.length, 2);
    const sections = shards.map((s) => s.metadata.section).sort();
    assertEquals(sections, ["GET /users", "POST /users"]);
    assert(shards.some((s) => s.content.includes("# GET /users — List users")));
    assert(shards.every((s) => s.content.includes("Demo API")));
});

Deno.test("plain (non-OpenAPI) JSON falls back to text chunking", () => {
    const shards = helpers().chunkDbFile(
        file("data.json", "application/json", '{"hello":"world"}'),
    );
    assertEquals(shards.length, 1);
    assert(shards[0].content.includes("hello"));
});

Deno.test("YAML MIME types are chunkable (not skipped)", () => {
    const shards = helpers().chunkDbFile(
        file("spec.yaml", "application/yaml", "openapi: 3.0.0\npaths: {}"),
    );
    assert(shards.length >= 1);
});
