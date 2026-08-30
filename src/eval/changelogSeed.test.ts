import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
    CHANGELOG_SEEDS,
    driftEvidenceSignals,
    expectedApiSymbols,
    renderChangelogSeed,
    scoreBreakingChanges,
    stripStackNoise,
} from "./changelogSeed.ts";

Deno.test("expectedApiSymbols extracts distinctive API identifiers, not generic words", () => {
    const execa = expectedApiSymbols(CHANGELOG_SEEDS.execa);
    assert(execa.includes("execaCommand"), `expected execaCommand in ${JSON.stringify(execa)}`);
    assert(execa.includes("parseCommandString"), "expected parseCommandString");
    assert(!execa.includes("template"), "template is not a distinctive API symbol");
    assert(!execa.includes("ipc"), "ipc is too short/generic");
    for (const [key, s] of Object.entries(CHANGELOG_SEEDS)) {
        for (const sym of expectedApiSymbols(s)) {
            assert(/^[A-Za-z_$][\w$.]*$/.test(sym), `${key}: bad symbol ${sym}`);
        }
    }
});

Deno.test("every seed is well-formed: version pair, url, ≥1 breaking change", () => {
    for (const [key, s] of Object.entries(CHANGELOG_SEEDS)) {
        assert(s.pkg.length > 0, `${key}: pkg`);
        assert(s.oldVersion !== s.newVersion, `${key}: distinct versions`);
        assert(s.changelogUrl.startsWith("https://"), `${key}: changelog url`);
        assert(s.breakingChanges.length >= 1, `${key}: has breaking changes`);
        for (const b of s.breakingChanges) {
            assert(b.matchKeywords.length >= 1, `${key}/${b.id}: keywords`);
            assert(b.oldUsageHint.length > 0, `${key}/${b.id}: oldUsageHint`);
        }
    }
});

Deno.test("breaking-change ids are unique within each seed", () => {
    for (const [key, s] of Object.entries(CHANGELOG_SEEDS)) {
        const ids = s.breakingChanges.map((b) => b.id);
        assertEquals(new Set(ids).size, ids.length, `${key}: duplicate ids`);
    }
});

Deno.test("renderChangelogSeed is empty for no seed", () => {
    assertEquals(renderChangelogSeed(undefined), "");
});

Deno.test("all seeds pin a NEW version released in 2026 (post-cutoff)", () => {
    const newMajor: Record<string, string> = {
        commander: "15",
        execa: "10",
        got: "15",
        ky: "2",
        eslint: "10",
        vite: "8",
        typeorm: "1",
        mikroorm: "7",
        undici: "8",
        marked: "18",
    };
    for (const [key, maj] of Object.entries(newMajor)) {
        assertEquals(CHANGELOG_SEEDS[key].newVersion.split(".")[0], maj, key);
    }
});

Deno.test("renderChangelogSeed steers goals but hides the version/changelog", () => {
    const block = renderChangelogSeed(CHANGELOG_SEEDS.execa);
    assertStringIncludes(block, "OLD-API usage to exercise");
    assertStringIncludes(block, "execa@9.6.1");
    assertStringIncludes(block, "Do NOT");
    assertStringIncludes(block, "execaCommand");
});

Deno.test("scoreBreakingChanges: recall counts items whose keywords appear in signals", () => {
    const seed = CHANGELOG_SEEDS.execa;
    const score = scoreBreakingChanges(seed, [
        { text: "The docs use execaCommand('git status') which no longer exists in v10." },
    ]);
    assertEquals(score.total, seed.breakingChanges.length);
    assert(score.detected >= 1, `expected ≥1 detected, got ${score.detected}`);
    assert(score.perItem.find((p) => p.id === "execa-10-execacommand")?.detected);
});

Deno.test("scoreBreakingChanges: no signals → zero recall", () => {
    const seed = CHANGELOG_SEEDS.got;
    const score = scoreBreakingChanges(seed, []);
    assertEquals(score.detected, 0);
    assertEquals(score.recall, 0);
});

Deno.test("scoreBreakingChanges: keyword matches at a word start only", () => {
    const seed = CHANGELOG_SEEDS.got;
    assert(scoreBreakingChanges(seed, [{ text: "cancel the request" }]).detected >= 1);
    assertEquals(scoreBreakingChanges(seed, [{ text: "nothing relevant here" }]).detected, 0);
});

Deno.test("driftEvidenceSignals: a regressed step is evidence", () => {
    const s = driftEvidenceSignals({
        stepRegressions: [{ goal: "stream a request", evidence: "isStream is not a function" }],
    });
    assertEquals(s.length, 1);
    assertStringIncludes(s[0].text, "isStream");
});

Deno.test("driftEvidenceSignals: a gap already present in the baseline is NOT drift", () => {
    const gap = { fragment: "the docs say headers are strings", documentationGap: "AMBIGUOUS" };
    const s = driftEvidenceSignals({ experimentGaps: [gap], baselineGaps: [gap] });
    assertEquals(s.length, 0);
});

Deno.test("driftEvidenceSignals: a gap NEW in the experiment is drift evidence", () => {
    const s = driftEvidenceSignals({
        experimentGaps: [{ fragment: "prefixUrl was renamed", documentationGap: "INCORRECT" }],
        baselineGaps: [{ fragment: "something unrelated" }],
    });
    assertEquals(s.length, 1);
    assertStringIncludes(s[0].text, "prefixUrl");
});

Deno.test("recall is NOT inflated by seeded goals when nothing regressed", () => {
    const seed = CHANGELOG_SEEDS.eslint;
    const noDrift = driftEvidenceSignals({ stepRegressions: [], experimentGaps: [] });
    assertEquals(scoreBreakingChanges(seed, noDrift).detected, 0);

    const withDrift = driftEvidenceSignals({
        stepRegressions: [{ goal: "custom rule", evidence: "context.getScope is not a function" }],
    });
    assert(scoreBreakingChanges(seed, withDrift).detected >= 1);
});

Deno.test("seeded goal/description text is NOT evidence — only the runtime error is", () => {
    const s = driftEvidenceSignals({
        stepRegressions: [{
            goal: "exercise prefixUrl and error.response.json() together",
            description: "dispatch post with duck-typed blob body",
            evidence: "TypeError: something entirely unrelated",
        }],
    });
    assertEquals(s.length, 1);
    assertEquals(s[0].text, "TypeError: something entirely unrelated");
    assert(!s[0].text.includes("prefixUrl"), "goal text must not leak into evidence");
    assert(!s[0].text.includes("blob"), "step description must not leak into evidence");
});

Deno.test("a regression caused by change A does not credit unrelated change B", () => {
    const seed = CHANGELOG_SEEDS.undici;
    const signals = driftEvidenceSignals({
        stepRegressions: [{
            goal: "dispatch post with duck-typed blob body",
            description: "blob body upload",
            evidence: "InvalidArgumentError: invalid onRequestStart method",
        }],
    });
    const score = scoreBreakingChanges(seed, signals);
    const handler = score.perItem.find((p) => p.id === "undici-8-handler-wrappers");
    const blob = score.perItem.find((p) => p.id === "undici-8-blob");
    assert(handler?.detected, "the handler change IS evidenced by this error");
    assertEquals(blob?.detected, false, "the Blob change is NOT evidenced by this error");
});

Deno.test("generic tokens must not match ordinary stack traces", () => {
    const seed = CHANGELOG_SEEDS.typeorm;
    const score = scoreBreakingChanges(seed, [{
        text:
            "SyntaxError: The requested module 'typeorm' does not provide an export named 'createConnection'\n" +
            "    at #asyncInstantiate (node:internal/modules/esm/module_job:327:21)",
        source: "regression",
    }]);
    assert(
        score.perItem.find((p) => p.id === "typeorm-1-datasource-rename")?.detected,
        "the rename IS evidenced",
    );
    assertEquals(
        score.perItem.find((p) => p.id === "typeorm-1-node-drop")?.detected,
        false,
        "a stack-trace path must not evidence the Node-version drop",
    );
});

Deno.test("confirmed ≤ detected, and gap-only evidence never counts as confirmed", () => {
    const seed = CHANGELOG_SEEDS.execa;
    const gapOnly = scoreBreakingChanges(seed, [
        { text: "the docs describe execaCommand but it is gone", source: "gap" },
    ]);
    assertEquals(gapOnly.detected, 1);
    assertEquals(gapOnly.confirmed, 0, "a gap is not a demonstrated break");
    assertEquals(gapOnly.perItem.find((p) => p.detected)?.via, "gap");

    const regr = scoreBreakingChanges(seed, [
        { text: "does not provide an export named 'execaCommand'", source: "regression" },
    ]);
    assertEquals(regr.confirmed, 1);
    assertEquals(regr.perItem.find((p) => p.detected)?.via, "regression");
    for (const sc of [gapOnly, regr]) assert(sc.confirmed <= sc.detected);
});

Deno.test("a library's own stack frames are not evidence", () => {
    const seed = CHANGELOG_SEEDS.typeorm;
    const signals = driftEvidenceSignals({
        stepRegressions: [{
            evidence:
                'DataTypeNotSupportedError: Data type "tree-level" is not supported by "postgres"\\n' +
                "    at DataSource.buildMetadatas (/eval/node_modules/typeorm/data-source/DataSource.js:41:25)",
        }],
    });
    assertEquals(
        scoreBreakingChanges(seed, signals).perItem.find((p) =>
            p.id === "typeorm-1-datasource-rename"
        )?.detected,
        false,
        "an internal stack frame must not evidence the rename",
    );
    const real = driftEvidenceSignals({
        stepRegressions: [{
            evidence: "SyntaxError: 'typeorm' does not provide an export named 'createConnection'",
        }],
    });
    assert(
        scoreBreakingChanges(seed, real).perItem.find((p) => p.id === "typeorm-1-datasource-rename")
            ?.detected,
    );
});

Deno.test("stripStackNoise removes frames but keeps the analysis that follows", () => {
    const cleaned = stripStackNoise(
        "Error: boom\\n    at Foo.bar (/eval/node_modules/x/y.js:1:2) the docs omit prefixUrl",
    );
    assert(!cleaned.includes("Foo.bar"), "frame removed");
    assert(!cleaned.includes("node_modules"), "module path removed");
    assertStringIncludes(cleaned, "boom");
    assertStringIncludes(cleaned, "the docs omit prefixUrl");
});
