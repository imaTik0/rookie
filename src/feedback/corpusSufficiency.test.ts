/**
 * Unit tests for the corpus sufficiency pre-flight. Pure — no infra.
 * Run with: deno test src/feedback/corpusSufficiency.test.ts
 */
import { assert, assertEquals } from "@std/assert";
import { assessCorpus } from "./corpusSufficiency.ts";

function file(filename: string, content: string) {
    return { metadata: { filename }, buffer: new TextEncoder().encode(content) };
}

const GOOD_DOC = `# Users API
Authenticate with a Bearer token in the Authorization header.

## List users
GET /api/v1/users

\`\`\`js
const res = await fetch(ctx.apiBase + "/users", { headers: { Authorization: "Bearer " + ctx.token } });
\`\`\`

## Create user
POST /api/v1/users
`.repeat(8);

Deno.test("a healthy API corpus is sufficient with no warnings", () => {
    const a = assessCorpus([file("api.md", GOOD_DOC)], 1500);
    assertEquals(a.sufficient, true);
    assertEquals(a.warnings, []);
    assert(a.stats.codeBlocks >= 5);
    assert(a.stats.endpointMentions >= 10);
    assert(a.stats.authMentions > 0);
});

Deno.test("a tiny corpus fails the hard gate with an explanatory warning", () => {
    const a = assessCorpus([file("landing.md", "# Welcome\nSee our docs.")], 1500);
    assertEquals(a.sufficient, false);
    assert(a.warnings[0].includes("too thin to evaluate"));
});

Deno.test("minCorpusChars=0 disables the hard gate", () => {
    const a = assessCorpus([file("landing.md", "# Welcome")], 0);
    assertEquals(a.sufficient, true);
});

Deno.test("missing code examples produce a warning", () => {
    const noCode = "# API\nGET /users returns users. Authorization: Bearer token.\n".repeat(60);
    const a = assessCorpus([file("api.md", noCode)], 1500);
    assertEquals(a.sufficient, true);
    assert(a.warnings.some((w) => w.includes("no fenced code examples")));
});

Deno.test("a corpus with no HTTP-API traces warns about a possibly wrong crawl", () => {
    const prose = "# About\nOur mission is to build great things together.\n".repeat(60);
    const a = assessCorpus([file("about.md", prose)], 1500);
    assert(a.warnings.some((w) => w.includes("No HTTP-API traces")));
});

Deno.test("many nav-shell-sized pages produce a crawl warning", () => {
    const shells = Array.from({ length: 8 }, (_, i) => file(`p${i}.md`, "# Page\nnav nav nav"));
    const a = assessCorpus(shells, 0);
    assert(a.warnings.some((w) => w.includes("navigation shells")));
});

Deno.test("one file dominating the corpus produces a dominance warning", () => {
    const a = assessCorpus(
        [file("big.md", GOOD_DOC), file("stub.md", "# x")],
        1500,
    );
    assert(a.warnings.some((w) => w.includes(">90% of the corpus")));
});

Deno.test("binary files contribute file count but no content", () => {
    const a = assessCorpus([file("logo.png", "PNGBYTES".repeat(1000))], 1500);
    assertEquals(a.stats.files, 1);
    assertEquals(a.stats.totalChars, 0);
    assertEquals(a.sufficient, false);
});
