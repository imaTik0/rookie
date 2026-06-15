/**
 * Unit tests for documentation code-example extraction. Pure — no infra.
 * Run with: deno test src/feedback/docExamples.test.ts
 */
import { assert, assertEquals } from "@std/assert";
import { docExampleLabel, extractDocExamples } from "./docExamples.ts";

function md(filename: string, content: string) {
    return { metadata: { filename }, buffer: new TextEncoder().encode(content) };
}

Deno.test("extracts a JS fence with section, context and 1-based line number", () => {
    const content = [
        "# Quickstart", // line 1
        "", // 2
        "Call the client like so:", // 3
        "```js", // 4
        'const c = require("sdk"); c.connect();', // 5
        "```", // 6
    ].join("\n");
    const [ex] = extractDocExamples([md("readme.md", content)]);
    assertEquals(ex.language, "js");
    assertEquals(ex.lineNumber, 4);
    assertEquals(ex.section, "Quickstart");
    assertEquals(ex.context, "Call the client like so:");
    assert(ex.code.includes("c.connect()"));
});

Deno.test("captures js/ts/javascript/typescript but ignores other languages", () => {
    const content = [
        "```python",
        "print('this is long enough to pass the length filter')",
        "```",
        "```ts",
        "export const answer: number = 42424242;",
        "```",
    ].join("\n");
    const exs = extractDocExamples([md("x.md", content)]);
    assertEquals(exs.length, 1);
    assertEquals(exs[0].language, "ts");
});

Deno.test("ignores unlabelled fences (avoids noise)", () => {
    const content = "```\nconst plain = 'no language tag here at all';\n```";
    assertEquals(extractDocExamples([md("x.md", content)]).length, 0);
});

Deno.test("skips trivially short snippets (< 20 chars)", () => {
    const content = "```js\nx=1;\n```";
    assertEquals(extractDocExamples([md("x.md", content)]).length, 0);
});

Deno.test("skips binary/unsupported file extensions", () => {
    const content = "```js\nconst longEnoughSnippet = true;\n```";
    assertEquals(extractDocExamples([md("logo.png", content)]).length, 0);
});

Deno.test("docExampleLabel joins filename, section and line", () => {
    assertEquals(
        docExampleLabel({
            filename: "a.md",
            section: "Setup",
            language: "js",
            code: "x",
            lineNumber: 12,
        }),
        "a.md › Setup › line 12",
    );
    assertEquals(
        docExampleLabel({ filename: "a.md", language: "js", code: "x", lineNumber: 3 }),
        "a.md › line 3",
    );
});
