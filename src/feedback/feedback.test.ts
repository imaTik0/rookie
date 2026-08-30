import { assertEquals, assertStringIncludes } from "@std/assert";
import {
    corpusMentions,
    extractMissingModule,
    splitFragmentPrefix,
    tokenOverlap,
    verifyFragment,
} from "./fragmentVerify.ts";
import {
    clusterGaps,
    collectFindings,
    GapFinding,
    taxonomyOf,
    topFailingFunctionsOf,
} from "./gapAggregate.ts";
import { generateDocsPatch } from "./docsPatch.ts";
import type * as types from "../types/index.ts";

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

Deno.test("splitFragmentPrefix strips [file]: prefix", () => {
    const r = splitFragmentPrefix("[lodash.md]: Use `chunkArray(array, size)`");
    assertEquals(r.fileHint, "lodash.md");
    assertEquals(r.text, "Use `chunkArray(array, size)`");
    const noPrefix = splitFragmentPrefix("plain fragment");
    assertEquals(noPrefix.fileHint, undefined);
});

Deno.test("verifyFragment finds exact quotes with line numbers", () => {
    const v = verifyFragment(
        "Use `chunkArray(array, size)` to split an array into groups of `size`:",
        CORPUS,
    );
    assertEquals(v.verified, true);
    assertEquals(v.file, "lodash.md");
    assertEquals(v.matchScore, 1);
    assertEquals(v.lineStart, 7);
});

Deno.test("verifyFragment fuzzy-matches paraphrased quotes", () => {
    const v = verifyFragment(
        "[lodash.md]: chunkArray(array, size) splits an array into groups of size",
        CORPUS,
    );
    assertEquals(v.verified, true);
    assertEquals(v.file, "lodash.md");
    assertEquals(v.matchScore < 1, true);
});

Deno.test("verifyFragment rejects hallucinated quotes", () => {
    const v = verifyFragment(
        "Call initializeClient() with your OAuth refresh token before any request",
        CORPUS,
    );
    assertEquals(v.verified, false);
});

Deno.test("tokenOverlap basic behaviour", () => {
    assertEquals(tokenOverlap("foo bar baz", "foo bar baz"), 1);
    assertEquals(tokenOverlap("foo", "completely different") < 0.5, true);
});

Deno.test("extractMissingModule parses node errors", () => {
    assertEquals(extractMissingModule("Error: Cannot find module 'dayjs'"), "dayjs");
    assertEquals(
        extractMissingModule("Cannot find package '@scope/pkg' imported from /app/x.js"),
        "@scope/pkg",
    );
    assertEquals(extractMissingModule("Cannot find module './local.js'"), null);
    assertEquals(extractMissingModule("TypeError: x is not a function"), null);
});

Deno.test("corpusMentions is case-insensitive", () => {
    assertEquals(corpusMentions(CORPUS, "LODASH"), true);
    assertEquals(corpusMentions(CORPUS, "sendgrid"), false);
});

function makeFinding(
    goal: string,
    fn: string,
    gap: types.report.DocumentationGap,
    overrides: Partial<types.report.FailureAnalysis> = {},
): GapFinding {
    return {
        goal,
        reportId: `rep-${goal}`,
        stepIndex: 1,
        analysis: {
            errorMessage: "err",
            failedFunction: fn,
            documentationGap: gap,
            reasoning: "r",
            suggestedDocsFix: "fix",
            confidence: 1,
            ...overrides,
        },
    };
}

Deno.test("clusterGaps merges same function+category across goals", () => {
    const clusters = clusterGaps([
        makeFinding("goal A", "_.chunkArray", "INCORRECT"),
        makeFinding("goal B", "_.chunkArray", "INCORRECT"),
        makeFinding("goal C", "dayjs.fromNow", "CONFIG"),
    ]);
    assertEquals(clusters.length, 2);
    assertEquals(clusters[0].occurrences, 2);
    assertEquals(clusters[0].affectedGoals.length, 2);
});

Deno.test("clusterGaps merges by verified line-range overlap", () => {
    const verification = {
        verified: true,
        file: "lodash.md",
        lineStart: 7,
        lineEnd: 9,
        matchScore: 1,
    };
    const clusters = clusterGaps([
        makeFinding("goal A", "fnA", "INCORRECT", { fragmentVerification: verification }),
        makeFinding("goal B", "fnB", "MISSING", {
            fragmentVerification: { ...verification, lineStart: 8, lineEnd: 10 },
        }),
    ]);
    assertEquals(clusters.length, 1);
});

Deno.test("clusterGaps prefers verified representative", () => {
    const clusters = clusterGaps([
        makeFinding("goal A", "_.chunkArray", "INCORRECT", {
            pinpointedFragment: "hallucinated quote",
            confidence: 1,
        }),
        makeFinding("goal B", "_.chunkArray", "INCORRECT", {
            pinpointedFragment: "real quote",
            proposedFragment: "Use `chunk(array, size)`",
            confidence: 0.6,
            fragmentVerification: {
                verified: true,
                file: "lodash.md",
                lineStart: 7,
                lineEnd: 7,
                matchScore: 1,
                matchedText: "real quote",
            },
        }),
    ]);
    assertEquals(clusters.length, 1);
    assertEquals(clusters[0].verified, true);
    assertEquals(clusters[0].file, "lodash.md");
    assertEquals(clusters[0].fragment, "real quote");
});

Deno.test("collectFindings skips ENVIRONMENT and empty analyses", () => {
    const reports = [{
        goal: "g",
        reportId: "r1",
        steps: [
            { stepIndex: 1, failureAnalysis: makeFinding("g", "fn", "MISSING").analysis },
            { stepIndex: 2, failureAnalysis: makeFinding("g", "fn2", "ENVIRONMENT").analysis },
            { stepIndex: 3 },
        ],
    }];
    const findings = collectFindings(reports);
    assertEquals(findings.length, 1);
    assertEquals(findings[0].analysis.documentationGap, "MISSING");
});

Deno.test("taxonomyOf and topFailingFunctionsOf are deterministic", () => {
    const findings = [
        makeFinding("a", "fnX", "MISSING"),
        makeFinding("b", "fnX", "MISSING"),
        makeFinding("c", "fnY", "CONFIG"),
        makeFinding("d", "unknown", "UNKNOWN"),
    ];
    assertEquals(taxonomyOf(findings), { MISSING: 2, CONFIG: 1, UNKNOWN: 1 });
    const top = topFailingFunctionsOf(findings);
    assertEquals(top[0], { functionName: "fnX", count: 2, goals: ["a", "b"] });
    assertEquals(top.length, 2);
});

Deno.test("generateDocsPatch produces a unified diff for verified clusters", () => {
    const clusters = clusterGaps([
        makeFinding("goal A", "_.chunkArray", "INCORRECT", {
            proposedFragment: "Use `chunk(array, size)` to split an array into groups of `size`:",
            fragmentVerification: {
                verified: true,
                file: "lodash.md",
                lineStart: 7,
                lineEnd: 7,
                matchScore: 1,
                matchedText:
                    "Use `chunkArray(array, size)` to split an array into groups of `size`:",
            },
        }),
    ]);
    const result = generateDocsPatch(clusters, CORPUS);
    assertEquals(result.patchedClusters, 1);
    assertStringIncludes(result.patch, "--- a/lodash.md");
    assertStringIncludes(result.patch, "-Use `chunkArray(array, size)`");
    assertStringIncludes(result.patch, "+Use `chunk(array, size)`");
    assertStringIncludes(result.markdown, "```diff");
});

Deno.test("generateDocsPatch lists unverified clusters as suggestions", () => {
    const clusters = clusterGaps([
        makeFinding("goal A", "mystery.fn", "MISSING", {
            suggestedDocsFix: "Document mystery.fn",
        }),
    ]);
    const result = generateDocsPatch(clusters, CORPUS);
    assertEquals(result.patchedClusters, 0);
    assertEquals(result.unpatchedClusters, 1);
    assertEquals(result.patch, "");
    assertStringIncludes(result.markdown, "Document mystery.fn");
});

Deno.test("generateDocsPatch skips overlapping edits in the same file", () => {
    const verification = {
        verified: true,
        file: "lodash.md",
        matchScore: 1,
        matchedText: "x",
    };
    const clusters = [
        ...clusterGaps([
            makeFinding("a", "fn1", "INCORRECT", {
                proposedFragment: "fix one",
                fragmentVerification: { ...verification, lineStart: 7, lineEnd: 8 },
            }),
        ]),
        ...clusterGaps([
            makeFinding("b", "fn2", "AMBIGUOUS", {
                proposedFragment: "fix two",
                fragmentVerification: { ...verification, lineStart: 8, lineEnd: 9 },
            }),
        ]),
    ];
    const result = generateDocsPatch(clusters, CORPUS);
    assertEquals(result.patchedClusters, 1);
});
