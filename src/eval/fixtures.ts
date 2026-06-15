/**
 * Evaluation fixtures: small documentation sets with KNOWN, injected defects.
 *
 * Each fixture documents a real npm library but seeds a specific, deliberate
 * documentation gap. When Rookie writes code from these docs and runs it in the
 * sandbox, the code crashes in a predictable way — letting us check both whether
 * the gap was DETECTED and whether it was CLASSIFIED into the right category.
 *
 * These are seeds: add your own to grow the benchmark. The point is a labelled
 * ground truth (mirroring RestBench / APISumBench in the cited literature) so the
 * "we detect doc gaps better than static analysis" claim can be measured.
 */
import type { GapLabel } from "./metrics.ts";

export interface ExpectedDefect {
    id: string;
    file: string;
    expectedGap: GapLabel;
    note: string;
    /** Any of these substrings appearing in the failure analysis counts as a match. */
    matchKeywords: string[];
}

export interface EvalFixture {
    name: string;
    files: { filename: string; mimetype: string; content: string }[];
    goals: string[];
    expectedDefects: ExpectedDefect[];
    /**
     * Optional corrected version of the documentation files.
     * When present, the evaluation runner will re-run the SAME goals (from the
     * initial master plan) against a project built from these files and compute
     * a before/after comparison — measuring how many defects were resolved by
     * the documentation fix.
     */
    fixedFiles?: { filename: string; mimetype: string; content: string }[];
}

export const FIXTURES: EvalFixture[] = [
    {
        name: "rookie-eval-lodash-incorrect-fn",
        files: [{
            filename: "lodash.md",
            mimetype: "text/markdown",
            content: `# lodash array utilities

Install with \`npm install lodash\`.

## Splitting arrays

Use \`chunkArray(array, size)\` to split an array into groups of \`size\`:

\`\`\`js
import _ from "lodash";
const groups = _.chunkArray([1, 2, 3, 4, 5], 2);
// => [[1, 2], [3, 4], [5]]
\`\`\`

It returns a new array of arrays and does not mutate the input.
`,
        }],
        goals: [
            "Using the documented lodash function, split the array [1,2,3,4,5] into chunks of size 2 and print the result.",
        ],
        // lodash exposes `_.chunk`, NOT `_.chunkArray` — the doc names a function that does not exist.
        expectedDefects: [{
            id: "lodash-chunkArray",
            file: "lodash.md",
            expectedGap: "INCORRECT",
            note: "Docs reference _.chunkArray; the real function is _.chunk.",
            matchKeywords: ["chunkArray", "chunk", "is not a function"],
        }],
        // Fixed version: corrects the function name from `chunkArray` to `chunk`.
        fixedFiles: [{
            filename: "lodash.md",
            mimetype: "text/markdown",
            content: `# lodash array utilities

Install with \`npm install lodash\`.

## Splitting arrays

Use \`chunk(array, size)\` to split an array into groups of \`size\`:

\`\`\`js
import _ from "lodash";
const groups = _.chunk([1, 2, 3, 4, 5], 2);
// => [[1, 2], [3, 4], [5]]
\`\`\`

It returns a new array of arrays and does not mutate the input.
`,
        }],
    },
    {
        name: "rookie-eval-dayjs-missing-plugin",
        files: [{
            filename: "dayjs.md",
            mimetype: "text/markdown",
            content: `# dayjs relative time

Install with \`npm install dayjs\`.

## Human-readable relative time

Call \`.fromNow()\` on any dayjs object to get a relative string such as
"a few seconds ago":

\`\`\`js
import dayjs from "dayjs";
const text = dayjs("2020-01-01").fromNow();
console.log(text);
\`\`\`
`,
        }],
        goals: [
            "Using dayjs as documented, print the relative time from the date 2020-01-01 to now.",
        ],
        // `.fromNow()` requires `dayjs.extend(relativeTime)` first — the doc omits this required setup.
        expectedDefects: [{
            id: "dayjs-relativeTime-plugin",
            file: "dayjs.md",
            expectedGap: "CONFIG",
            note:
                "fromNow() needs the relativeTime plugin via dayjs.extend(); setup is undocumented.",
            matchKeywords: ["fromNow", "extend", "relativeTime", "is not a function"],
        }],
        // Fixed version: adds the required `dayjs.extend(relativeTime)` call.
        fixedFiles: [{
            filename: "dayjs.md",
            mimetype: "text/markdown",
            content: `# dayjs relative time

Install with \`npm install dayjs\`.

## Human-readable relative time

Call \`.fromNow()\` on any dayjs object to get a relative string such as
"a few seconds ago".

**Required setup:** before using \`.fromNow()\` you must load the \`relativeTime\` plugin:

\`\`\`js
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
dayjs.extend(relativeTime);

const text = dayjs("2020-01-01").fromNow();
console.log(text);
\`\`\`
`,
        }],
    },
];
