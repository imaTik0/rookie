import { assert, assertEquals } from "@std/assert";
import { verifyFragment } from "./fragmentVerify.ts";

const DOC = `# lodash array utilities

Install with \`npm install lodash\`.

## Splitting arrays

Use \`chunkArray(array, size)\` to split an array into groups of \`size\`:

\`\`\`js
import _ from "lodash";
const groups = _.chunkArray([1, 2, 3, 4, 5], 2);
\`\`\`

It returns a new array of arrays and does not mutate the input.
`;
const CORPUS = [{ filename: "lodash.md", content: DOC }];

Deno.test("short single-line paraphrase verifies against a small doc", () => {
    const v = verifyFragment(
        "[lodash.md]: chunkArray(array, size) splits an array into groups of size",
        CORPUS,
    );
    assertEquals(v.verified, true);
    assertEquals(v.file, "lodash.md");
    assert(v.matchScore >= 0.55);
});

Deno.test("exact single-line fragment still verifies with score 1", () => {
    const v = verifyFragment(
        "Use `chunkArray(array, size)` to split an array into groups of `size`:",
        CORPUS,
    );
    assertEquals(v.verified, true);
    assertEquals(v.matchScore, 1);
});

Deno.test("hallucinated fragment is still rejected", () => {
    const v = verifyFragment(
        "Call initializeClient() with your OAuth refresh token before any request",
        CORPUS,
    );
    assertEquals(v.verified, false);
});

Deno.test("a fragment longer than the document does not crash", () => {
    const tiny = [{ filename: "x.md", content: "one line only" }];
    const v = verifyFragment("line one\nline two\nline three\nline four", tiny);
    assertEquals(typeof v.verified, "boolean");
});
