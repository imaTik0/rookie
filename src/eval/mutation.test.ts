import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
    applySite,
    enumerateSites,
    gapMatchesMutant,
    generateMutants,
    type Mutant,
    parsePlannerComplete,
    relevantGoalIndices,
} from "./mutation.ts";

const GOLD = `# Users API

Authenticate with a Bearer token.

## Create user

POST /api/v1/users

Parameters:

- \`name\` (string, required): display name of the user.
- \`age\` (number, optional): age in years.
- \`X-Request-Id\` (string, optional header): correlation id.

\`\`\`js
const res = await createUser({ name: "Ada", age: 36 });
\`\`\`

Returns the created user object.
`;

const FILES = [{ filename: "users.md", content: GOLD }];

Deno.test("enumerateSites finds sites for all four operators", () => {
    const sites = enumerateSites(FILES);
    const ops = new Set(sites.map((s) => s.operator));
    assertEquals(ops, new Set(["DelParam", "DelExmpl", "ObfuscateType", "AddFalseInfo"]));
});

Deno.test("param lines inside code fences are not sites", () => {
    const fenced = [{
        filename: "f.md",
        content: "```\n- `inner` (string, required): not a real param line\n```\n",
    }];
    assertEquals(enumerateSites(fenced).filter((s) => s.operator === "DelParam"), []);
});

Deno.test("non-markdown files are skipped", () => {
    assertEquals(enumerateSites([{ filename: "spec.json", content: GOLD }]), []);
});

Deno.test("DelParam removes exactly the parameter line", () => {
    const site = enumerateSites(FILES).find(
        (s) => s.operator === "DelParam" && s.matchKeywords[0] === "age",
    )!;
    const { files } = applySite(FILES, site);
    assert(!files[0].content.includes("`age`"));
    assert(files[0].content.includes("`name`"));
    assertEquals(
        files[0].content.split("\n").length,
        GOLD.split("\n").length - 1,
    );
});

Deno.test("DelExmpl removes the whole fenced block including fences", () => {
    const site = enumerateSites(FILES).find((s) => s.operator === "DelExmpl")!;
    const { files } = applySite(FILES, site);
    assert(!files[0].content.includes("```"));
    assert(!files[0].content.includes("createUser({"));
    assert(files[0].content.includes("Returns the created user object."));
});

Deno.test("ObfuscateType replaces one precise type with string", () => {
    const site = enumerateSites(FILES).find(
        (s) => s.operator === "ObfuscateType" && s.description.includes("number"),
    )!;
    const { files } = applySite(FILES, site);
    assert(files[0].content.includes("`age` (string, optional)"));
    assert(files[0].content.includes("`name` (string, required)"));
});

Deno.test("AddFalseInfo inserts the fake parameter after a real one", () => {
    const site = enumerateSites(FILES).find((s) => s.operator === "AddFalseInfo")!;
    const { files, woundLine } = applySite(FILES, site);
    assertStringIncludes(files[0].content, "xVerifyMode");
    assertEquals(files[0].content.split("\n")[woundLine - 1].includes("xVerifyMode"), true);
    assertEquals(
        files[0].content.split("\n").length,
        GOLD.split("\n").length + 1,
    );
});

Deno.test("generateMutants is deterministic for a given seed", () => {
    const a = generateMutants(FILES, { seed: 42, perOperator: 1 });
    const b = generateMutants(FILES, { seed: 42, perOperator: 1 });
    assertEquals(a.map((m) => m.id), b.map((m) => m.id));
});

Deno.test("each mutant is first-order and carries the expected gap label", () => {
    const mutants = generateMutants(FILES, { seed: 7, perOperator: 1 });
    assertEquals(mutants.length, 4);
    for (const m of mutants) {
        assert(m.files[0].content !== GOLD, `${m.id} must differ from gold`);
        assertEquals(
            m.expectedGap,
            {
                DelParam: "MISSING",
                DelExmpl: "MISSING",
                ObfuscateType: "AMBIGUOUS",
                AddFalseInfo: "INCORRECT",
            }[m.operator],
        );
    }
});

const mutant: Mutant = {
    id: "DelParam-users.md-L12",
    operator: "DelParam",
    expectedGap: "MISSING",
    file: "users.md",
    woundLine: 12,
    description: "delete `age`",
    matchKeywords: ["age"],
    files: FILES,
};

Deno.test("gapMatchesMutant: verified fragment near the wound matches", () => {
    assert(gapMatchesMutant(
        {
            documentationGap: "MISSING",
            verified: true,
            file: "users.md",
            lineStart: 9,
            lineEnd: 14,
        },
        mutant,
    ));
});

Deno.test("gapMatchesMutant: far-away fragment in another file does not match", () => {
    assertEquals(
        gapMatchesMutant(
            {
                documentationGap: "MISSING",
                verified: true,
                file: "other.md",
                lineStart: 12,
                lineEnd: 12,
                reasoning: "irrelevant",
            },
            mutant,
        ),
        false,
    );
});

Deno.test("gapMatchesMutant: keyword fallback matches unverified analyses", () => {
    assert(gapMatchesMutant(
        { documentationGap: "MISSING", reasoning: "The docs never define the age field" },
        mutant,
    ));
});

const MULTILIB_GOALS = [
    "Using the documented lodash functions, split [1,2,3] into chunks of 3.",
    "Using the documented lodash functions, group words by their length.",
    "Using the documented dayjs API, compute days between two dates.",
    "Using the documented ms API, convert '3 hours' to milliseconds.",
];

Deno.test("relevantGoalIndices restricts to goals mentioning the wounded file's library", () => {
    const idx = relevantGoalIndices(
        { file: "dayjs.md", goalHints: [] },
        MULTILIB_GOALS,
    );
    assertEquals(idx, [2]);
});

Deno.test("relevantGoalIndices narrows by section hint within the library pool", () => {
    const idx = relevantGoalIndices(
        { file: "lodash.md", goalHints: ["chunk"] },
        MULTILIB_GOALS,
    );
    assertEquals(idx, [0]);
});

Deno.test("relevantGoalIndices falls back to the library pool when no hint matches", () => {
    const idx = relevantGoalIndices(
        { file: "lodash.md", goalHints: ["xVerifyMode"] },
        MULTILIB_GOALS,
    );
    assertEquals(idx, [0, 1]);
});

Deno.test("relevantGoalIndices falls back to ALL goals when the stem matches nothing", () => {
    const idx = relevantGoalIndices(
        { file: "unknown-lib.md", goalHints: [] },
        MULTILIB_GOALS,
    );
    assertEquals(idx, [0, 1, 2, 3]);
});

Deno.test("relevantGoalIndices: file stem must match at a word start ('ms' ≠ 'forms')", () => {
    const idx = relevantGoalIndices(
        { file: "ms.md", goalHints: [] },
        ["Submit two forms and print the params.", "Using the ms API, parse '2h'."],
    );
    assertEquals(idx, [1]);
});

Deno.test("enumerateSites detects heading-style options (real API-doc format)", () => {
    const files = [{
        filename: "api.md",
        content: [
            "#### options.timeout",
            "",
            "_Type:_ `number`",
            "",
            "Abort after N milliseconds.",
            "",
            "#### notAnOption",
            "",
            "Just prose, no type line.",
        ].join("\n"),
    }];
    const sites = enumerateSites(files);
    const delParam = sites.filter((s) => s.operator === "DelParam");
    const addFalse = sites.filter((s) => s.operator === "AddFalseInfo");
    assert(delParam.some((s) => s.matchKeywords.includes("options.timeout")));
    assert(delParam.some((s) => s.matchKeywords.includes("timeout")));
    assert(!delParam.some((s) => s.matchKeywords.includes("notAnOption")));
    assert(addFalse.length >= 1, "heading option yields an AddFalseInfo site");
    assert(sites.some((s) => s.operator === "ObfuscateType" && s.description.includes("number")));
});

Deno.test("enumerateSites attaches section-identifier goalHints to param sites", () => {
    const files = [{
        filename: "lib.md",
        content: "## chunk(array, size)\n\n- `size` (number, required): chunk length.\n",
    }];
    const site = enumerateSites(files).find((s) => s.operator === "DelParam")!;
    assertEquals(site.goalHints, ["chunk"]);
});

Deno.test("generated mutants carry goalHints through from their site", () => {
    const mutants = generateMutants(FILES, { seed: 7, perOperator: 1 });
    for (const m of mutants) {
        assert(Array.isArray(m.goalHints), `${m.id} should carry goalHints`);
    }
});

Deno.test("parsePlannerComplete reads the report from the controller's `result` wrapper", () => {
    const evt = {
        type: "COMPLETE",
        result: {
            _id: "mp1",
            masterPlanGoals: ["goal A", "goal B"],
            structuredSummary: {
                goalsBreakdown: [{ status: "SUCCESS" }, { status: "FAILED" }],
                documentationGapDetails: [{
                    documentationGap: "MISSING",
                    fragment: "x",
                    proposedFix: "y",
                    file: "a.md",
                    lineStart: 3,
                    lineEnd: 5,
                    verified: true,
                }],
            },
        },
    };
    const outcome = parsePlannerComplete(evt);
    assertEquals(outcome.masterPlanId, "mp1");
    assertEquals(outcome.goals, ["goal A", "goal B"]);
    assertEquals(outcome.passRate, 0.5);
    assertEquals(outcome.gaps.length, 1);
    assertEquals(outcome.gaps[0].documentationGap, "MISSING");
    assertEquals(outcome.gaps[0].suggestedDocsFix, "y");
    assertEquals(outcome.gaps[0].file, "a.md");
    assertEquals(outcome.gaps[0].lineStart, 3);
    assertEquals(outcome.gaps[0].verified, true);
});

Deno.test("parsePlannerComplete tolerates a bare report without the wrapper", () => {
    const outcome = parsePlannerComplete({
        type: "COMPLETE",
        _id: "mp2",
        structuredSummary: { goalsBreakdown: [{ status: "SUCCESS" }] },
    });
    assertEquals(outcome.masterPlanId, "mp2");
    assertEquals(outcome.passRate, 1);
    assertEquals(outcome.gaps, []);
});

Deno.test("parsePlannerComplete yields empty id and 0% on an unrecognized event", () => {
    const outcome = parsePlannerComplete({ type: "COMPLETE" });
    assertEquals(outcome.masterPlanId, "");
    assertEquals(outcome.passRate, 0);
    assertEquals(outcome.gaps, []);
});

Deno.test("perOperator 'all' generates one mutant per site", async () => {
    const { siteInventory } = await import("./mutation.ts");
    const inv = siteInventory(FILES);
    const mutants = generateMutants(FILES, { seed: 1, perOperator: "all" });
    assertEquals(mutants.length, inv.total);
    assert(new Set(mutants.map((m) => m.id)).size === mutants.length, "ids must be unique");
});

Deno.test("multiple type occurrences on one line are distinct sites, replaced independently", () => {
    const files = [{
        filename: "t.md",
        content: "- `mix` (number, required): pairs a number with a boolean flag.\n",
    }];
    const sites = enumerateSites(files).filter((s) => s.operator === "ObfuscateType");
    assertEquals(sites.length, 3);

    const boolSite = sites.find((s) => s.description.includes('"boolean"'))!;
    const { files: mutated } = applySite(files, boolSite);
    assert(mutated[0].content.includes("(number, required)"));
    assert(mutated[0].content.includes("a number with"));
    assert(!mutated[0].content.includes("boolean"));
    assert(mutated[0].content.includes("a string flag"));
});

Deno.test("the multilib gold corpus yields a large potential-mutant pool", async () => {
    const { GOLD_CORPORA } = await import("./goldCorpus.ts");
    const { siteInventory } = await import("./mutation.ts");
    const gold = GOLD_CORPORA[0].files.map((f) => ({
        filename: f.filename,
        content: f.content,
    }));
    const inv = siteInventory(gold);
    assert(inv.total >= 60, `expected >=60 potential mutants, got ${inv.total}`);
    for (const op of ["DelParam", "DelExmpl", "ObfuscateType", "AddFalseInfo"] as const) {
        assert(inv[op] >= 10, `${op}: expected >=10 sites, got ${inv[op]}`);
    }
});
