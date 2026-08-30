/**
 * changelogSeed.ts — changelog-driven goals + golden dataset for the
 * documentation-drift experiment.
 *
 * For each library we pin a version pair whose upstream changelog / migration
 * guide enumerates BREAKING changes. Each breaking change is encoded once and
 * serves TWO roles:
 *
 *   1. SEED for goal generation — `renderChangelogSeed()` turns the breaking
 *      changes into a steering block for the Master Planner: "a developer
 *      following the OLD docs would write code exercising these areas; such code
 *      works on the OLD version but breaks on the NEW one." The seed is injected
 *      ONLY into goal generation, never into the code-writing (RAG) phase — the
 *      code must still be written from the OLD documentation, so it genuinely
 *      breaks against the new version.
 *
 *   2. GOLDEN DATASET (ground truth) — `scoreBreakingChanges()` matches the
 *      drift the pipeline actually detected against this list, giving recall
 *      ("how many documented breaking changes surfaced as failures/gaps") and
 *      precision. Breaking changes are the priority signal.
 *
 * `changelogUrl` pins the upstream source each item was curated from, for
 * provenance and reviewer verification.
 */

/** Expected gap category when OLD-doc code meets the NEW version. */
export type BreakingCategory = "INCORRECT" | "MISSING" | "AMBIGUOUS";

/** The nature of the break (for reporting; breaking = highest priority). */
export type BreakingKind =
    | "removed"
    | "renamed"
    | "replaced"
    | "signature"
    | "behavior"
    | "default";

export interface BreakingChange {
    /** Stable id, e.g. "mongoose-7-remove". */
    id: string;
    /** What changed, in one line (the breaking fact). */
    summary: string;
    /**
     * The OLD-API usage a goal should exercise — valid per the OLD docs, broken
     * on the NEW version. Steers goal generation and anchors golden matching
     * (its keywords are matched against detected gaps).
     */
    oldUsageHint: string;
    kind: BreakingKind;
    /** Category the detector should assign when this drift is hit. */
    expectedCategory: BreakingCategory;
    /** Keywords that, appearing in a detected gap, indicate this item was hit. */
    matchKeywords: string[];
}

export interface ChangelogSeed {
    /** npm package under test. */
    pkg: string;
    oldVersion: string;
    newVersion: string;
    /** Pinned upstream changelog / migration guide the items were curated from. */
    changelogUrl: string;
    /** Golden dataset: the documented breaking changes (ground truth + seed). */
    breakingChanges: BreakingChange[];
}

// ── Curated golden datasets (breaking changes only) ──────────────────────────
// Each item is a documented, developer-visible breaking change: OLD-doc code
// using `oldUsageHint` runs on the old version and fails on the new one.

export const CHANGELOG_SEEDS: Record<string, ChangelogSeed> = {
    // ── 2026-only sample: NEW version released after the model's Jan-2026 cutoff,
    // so its breaking changes cannot be memorised — the model must rely on the
    // OLD docs. Breaking changes curated from the real upstream changelogs. ──

    commander: {
        pkg: "commander",
        oldVersion: "14.0.3",
        newVersion: "15.0.0",
        changelogUrl: "https://github.com/tj/commander.js/blob/v15.0.0/CHANGELOG.md",
        breakingChanges: [
            {
                id: "commander-15-esm-only",
                summary:
                    "Commander 15 is ESM-only; the CommonJS entry / `commander/esm.mjs` export was removed.",
                oldUsageHint:
                    "`const { program } = require('commander')` (CommonJS) as documented for v14",
                kind: "removed",
                expectedCategory: "INCORRECT",
                matchKeywords: ["require(", "commonjs", "esm", "esm.mjs", "import"],
            },
            {
                id: "commander-15-negatable-default",
                summary:
                    "A `--no-x` option only sets the default to true when defined alone; combined positive+negative no longer implies it.",
                oldUsageHint:
                    "define both `--flag` and `--no-flag` and rely on the v14 implicit default of true",
                kind: "behavior",
                expectedCategory: "AMBIGUOUS",
                matchKeywords: ["--no-", "negatable", "negated option"],
            },
        ],
    },

    execa: {
        pkg: "execa",
        oldVersion: "9.6.1",
        newVersion: "10.0.0",
        changelogUrl: "https://github.com/sindresorhus/execa/releases/tag/v10.0.0",
        breakingChanges: [
            {
                id: "execa-10-execacommand",
                summary:
                    "`execaCommand()` / `execaCommandSync()` were removed; use the template-string syntax or `parseCommandString()`.",
                oldUsageHint: "run a command string via `execaCommand('git status')`",
                kind: "removed",
                expectedCategory: "INCORRECT",
                matchKeywords: ["execaCommand", "parseCommandString"],
            },
            {
                id: "execa-10-ipc-stdio",
                summary:
                    "The old `stdio: [..., 'ipc']` syntax was removed; use the `ipc: true` option.",
                oldUsageHint: "enable IPC via `stdio: ['pipe','pipe','pipe','ipc']`",
                kind: "removed",
                expectedCategory: "INCORRECT",
                matchKeywords: ["ipc", "stdio"],
            },
        ],
    },

    got: {
        pkg: "got",
        oldVersion: "14.6.6",
        newVersion: "15.1.0",
        changelogUrl: "https://github.com/sindresorhus/got/releases/tag/v15.0.0",
        breakingChanges: [
            {
                id: "got-15-cancel",
                summary: "The promise `.cancel()` API was removed (use an AbortController signal).",
                oldUsageHint: "cancel an in-flight request via `promise.cancel()`",
                kind: "removed",
                expectedCategory: "INCORRECT",
                matchKeywords: ["cancel", "AbortController", "signal"],
            },
            {
                id: "got-15-isstream",
                summary:
                    "The `isStream` option was removed; piped-stream header copying is no longer automatic.",
                oldUsageHint: "make a streaming request via the `isStream: true` option",
                kind: "removed",
                expectedCategory: "INCORRECT",
                matchKeywords: ["isStream", "copyPipedHeaders"],
            },
            {
                id: "got-15-redirects",
                summary: "300 and 304 responses are no longer auto-followed.",
                oldUsageHint: "rely on Got auto-following a 300/304 redirect response",
                kind: "behavior",
                expectedCategory: "AMBIGUOUS",
                matchKeywords: ["redirect", "300", "304", "follow"],
            },
        ],
    },

    ky: {
        pkg: "ky",
        oldVersion: "1.14.3",
        newVersion: "2.0.2",
        changelogUrl: "https://github.com/sindresorhus/ky/releases/tag/v2.0.0",
        breakingChanges: [
            {
                id: "ky-2-prefixurl",
                summary:
                    "`prefixUrl` was renamed to `prefix` (and now allows leading slashes in input).",
                oldUsageHint: "set a base URL via the `prefixUrl` option",
                kind: "renamed",
                expectedCategory: "INCORRECT",
                matchKeywords: ["prefixUrl", "prefix"],
            },
            {
                id: "ky-2-error-data",
                summary:
                    "`error.response.json()` no longer works (body auto-consumed); use `error.data`.",
                oldUsageHint: "read an HTTP error body via `error.response.json()`",
                kind: "behavior",
                expectedCategory: "INCORRECT",
                matchKeywords: ["error.response", "error.data", "json()"],
            },
            {
                id: "ky-2-searchparams",
                summary:
                    "`searchParams` now merges with the input URL query instead of replacing it.",
                oldUsageHint: "rely on `searchParams` replacing existing query params in the URL",
                kind: "behavior",
                expectedCategory: "AMBIGUOUS",
                matchKeywords: ["searchParams"],
            },
        ],
    },

    eslint: {
        pkg: "eslint",
        oldVersion: "9.39.5",
        newVersion: "10.8.0",
        changelogUrl:
            "https://github.com/eslint/eslint/blob/v10.8.0/docs/src/use/migrate-to-10.0.0.md",
        breakingChanges: [
            {
                id: "eslint-10-sourcecode-methods",
                summary:
                    "Deprecated `SourceCode` / `context` methods (e.g. getScope, getAncestors) were removed.",
                oldUsageHint:
                    "use `context.getScope()` / `context.getAncestors()` inside a custom rule",
                kind: "removed",
                expectedCategory: "INCORRECT",
                matchKeywords: ["getScope", "getAncestors", "SourceCode", "context.get"],
            },
            {
                id: "eslint-10-eslintrc",
                summary:
                    "The old eslintrc config format is no longer supported (flat config only).",
                oldUsageHint:
                    "configure ESLint via `.eslintrc`/`overrideConfig` eslintrc-style options",
                kind: "removed",
                expectedCategory: "INCORRECT",
                matchKeywords: ["eslintrc", "flat config", "overrideConfig"],
            },
            {
                id: "eslint-10-lintmessage-nodetype",
                summary: "The `nodeType` property was removed from `LintMessage` objects.",
                oldUsageHint: "read `message.nodeType` from lint results",
                kind: "removed",
                expectedCategory: "INCORRECT",
                matchKeywords: ["nodeType", "LintMessage"],
            },
        ],
    },

    vite: {
        pkg: "vite",
        oldVersion: "7.3.6",
        newVersion: "8.1.5",
        changelogUrl: "https://github.com/vitejs/vite/blob/v8.1.5/docs/guide/migration.md",
        breakingChanges: [
            {
                id: "vite-8-esbuild-oxc",
                summary:
                    "esbuild transform replaced by Oxc; `esbuild` option deprecated and no longer a direct dependency.",
                oldUsageHint:
                    "configure JS transform via the `esbuild` option / `transformWithEsbuild`",
                kind: "replaced",
                expectedCategory: "INCORRECT",
                matchKeywords: ["esbuild", "oxc", "transformWithEsbuild", "transformWithOxc"],
            },
            {
                id: "vite-8-watch-chokidar",
                summary: "`build.rollupOptions.watch.chokidar` was removed (use rolldown watcher).",
                oldUsageHint: "set `build.rollupOptions.watch.chokidar` in the config",
                kind: "removed",
                expectedCategory: "INCORRECT",
                matchKeywords: ["chokidar", "rollupOptions", "watch", "rolldown"],
            },
        ],
    },

    typeorm: {
        pkg: "typeorm",
        oldVersion: "0.3.31",
        newVersion: "1.1.0",
        changelogUrl: "https://github.com/typeorm/typeorm/blob/1.1.0/CHANGELOG.md",
        breakingChanges: [
            {
                id: "typeorm-1-datasource-rename",
                summary:
                    "The `Connection` API/naming was fully replaced by `DataSource` (a codemod renames connection→dataSource).",
                oldUsageHint:
                    "use the `Connection` type / `connection` accessor as documented in 0.3",
                kind: "renamed",
                expectedCategory: "INCORRECT",
                matchKeywords: [
                    "createConnection",
                    "getConnection",
                    "DataSource",
                    "ConnectionOptions",
                ],
            },
            {
                id: "typeorm-1-node-drop",
                summary: "Support for Node.js 16 and 18 was dropped.",
                oldUsageHint: "assume the 0.3-documented Node 16/18 runtime support",
                kind: "removed",
                expectedCategory: "AMBIGUOUS",
                matchKeywords: ["engines", "Node.js 16", "Node.js 18", "unsupported node"],
            },
        ],
    },

    mikroorm: {
        pkg: "@mikro-orm/core",
        oldVersion: "6.6.16",
        newVersion: "7.1.7",
        changelogUrl:
            "https://github.com/mikro-orm/mikro-orm/blob/v7.1.7/docs/docs/upgrading-v6-to-v7.md",
        breakingChanges: [
            {
                id: "mikroorm-7-getknex",
                summary:
                    "knex was replaced by kysely as the query runner; `em.getKnex()` → `em.getKysely()`, `@mikro-orm/knex` → `@mikro-orm/sql`.",
                oldUsageHint:
                    "access the query builder via `em.getKnex()` / import from `@mikro-orm/knex`",
                kind: "renamed",
                expectedCategory: "INCORRECT",
                matchKeywords: ["getKnex", "getKysely", "@mikro-orm/knex", "@mikro-orm/sql"],
            },
            {
                id: "mikroorm-7-reflect-metadata",
                summary:
                    "`ReflectMetadataProvider` is no longer the default (moved to a legacy package).",
                oldUsageHint:
                    "rely on the default ReflectMetadataProvider / legacy decorators from v6",
                kind: "default",
                expectedCategory: "INCORRECT",
                matchKeywords: ["ReflectMetadataProvider", "reflect-metadata", "metadataProvider"],
            },
        ],
    },

    undici: {
        pkg: "undici",
        oldVersion: "7.29.0",
        newVersion: "8.9.0",
        changelogUrl: "https://github.com/nodejs/undici/releases/tag/v8.0.0",
        breakingChanges: [
            {
                id: "undici-8-handler-wrappers",
                summary:
                    "Legacy handler wrappers were removed (dispatcher handlers must use the new interface).",
                oldUsageHint: "pass a v7-style legacy handler object to `dispatch()`",
                kind: "removed",
                expectedCategory: "INCORRECT",
                matchKeywords: [
                    "onRequestStart",
                    "invalid handler",
                    "handler wrapper",
                    "dispatcher",
                ],
            },
            {
                id: "undici-8-blob",
                summary:
                    "Support for non-real Blob objects (duck-typed blobs) as request body was removed.",
                oldUsageHint: "send a duck-typed / non-native Blob as the request body",
                kind: "removed",
                expectedCategory: "AMBIGUOUS",
                matchKeywords: ["Blob", "duck-typed"],
            },
        ],
    },

    marked: {
        pkg: "marked",
        oldVersion: "17.0.6",
        newVersion: "18.0.7",
        changelogUrl: "https://github.com/markedjs/marked/releases/tag/v18.0.0",
        breakingChanges: [
            {
                id: "marked-18-table-tokens",
                summary:
                    "GFM table / heading tokenization changed (no longer greedily captures trailing newlines), altering token output.",
                oldUsageHint:
                    "rely on the v17 token stream from `marked.lexer()` for tables/headings",
                kind: "behavior",
                expectedCategory: "AMBIGUOUS",
                matchKeywords: ["lexer", "table raw", "trailing newline", "tokenizer"],
            },
        ],
    },
};

// ── Seed rendering (goal generation only) ────────────────────────────────────

/**
 * Render the changelog seed injected into GOAL GENERATION (never code-gen).
 * Returns "" when there is no seed, so prompts are unchanged for other targets.
 */
export function renderChangelogSeed(seed: ChangelogSeed | undefined): string {
    if (!seed || seed.breakingChanges.length === 0) return "";
    const items = seed.breakingChanges
        .map((b, i) =>
            `${i + 1}. (${b.kind}) ${b.summary}\n     OLD-API usage to exercise: ${b.oldUsageHint}`
        )
        .join("\n");
    return `
### VERSION-DRIFT FOCUS (GOAL TARGETING — do not reveal in the goal text)
The developer uses ${seed.pkg}@${seed.oldVersion} and follows ITS documentation. In
${seed.pkg}@${seed.newVersion} the following documented behaviours change in a BREAKING
way. Generate goals that a developer faithfully following the OLD documentation would
naturally write, and that exercise these areas — each goal MUST be fully valid and
achievable per the OLD docs (so it passes on the old version), while relying on the
OLD-API usage noted below (so it will break on the new version):

${items}

Write the goals as ordinary developer tasks phrased in terms of the OLD API. Do NOT
mention versions, changelogs, "breaking change", or the new behaviour in the goal text —
the goal must read like a normal task written from the current (old) documentation.`;
}

// ── Expected documented API symbols (docs-faithfulness) ──────────────────────

/** Generic tokens that are not distinctive API identifiers. */
const NON_API_TOKENS = new Set([
    "default",
    "boolean",
    "stream",
    "query",
    "body",
    "node",
    "import",
    "string",
    "number",
    "object",
    "header",
    "token",
    "signal",
    "redirect",
    "follow",
    "merge",
    "engines",
    "template",
    "watch",
    "options",
    "config",
    "handler",
    "dispatch",
]);

/**
 * Distinctive API identifiers a faithful implementation of the seed's goals
 * should reference (drives the docs-faithfulness check: code using NONE of these
 * dodged the documented API). Extracted from each breaking change's
 * `matchKeywords` and the backtick-quoted identifiers in its `oldUsageHint`,
 * keeping only distinctive names (camelCase, dotted, or long) — not generic words.
 */
export function expectedApiSymbols(seed: ChangelogSeed): string[] {
    const out = new Set<string>();
    const add = (raw: string): void => {
        const s = raw.trim().replace(/\(\)$/, "");
        if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(s) || s.length < 4) return;
        if (NON_API_TOKENS.has(s.toLowerCase())) return;
        if (/[A-Z]/.test(s) || s.includes(".") || s.length >= 8) out.add(s);
    };
    for (const b of seed.breakingChanges) {
        for (const k of b.matchKeywords) add(k);
        for (const m of b.oldUsageHint.matchAll(/`([^`]+)`/g)) {
            for (const id of m[1].matchAll(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g)) add(id[0]);
        }
    }
    return [...out];
}

// ── Golden-dataset scoring ───────────────────────────────────────────────────

export interface DetectedSignal {
    /** Free text the detector produced (gap reasoning, fragment, failed function, error). */
    text: string;
    /**
     * How strong this evidence is:
     *  "regression" — a runtime error/analysis from code that broke on the new
     *                 version (the change actually manifested);
     *  "gap"        — a documentation gap new in the experiment (the pipeline
     *                 flagged the area, but nothing demonstrably broke).
     */
    source?: "regression" | "gap";
}

/** A gap as reported in a run's structured summary (only the fields we score on). */
export interface GapLike {
    fragment?: unknown;
    reasoning?: unknown;
    proposedFix?: unknown;
    documentationGap?: unknown;
    file?: unknown;
}

/** A step that passed on the old version and failed on the new one. */
export interface RegressionLike {
    goal?: string;
    description?: string;
    /** Runtime error + classifier analysis — the ONLY drift-independent text here. */
    evidence?: string;
}

/**
 * Remove stack frames and module paths before keyword matching.
 *
 * A library's own internals name its APIs: typeorm raises errors through
 * `at DataSource.buildMetadatas (…/typeorm/data-source/DataSource.js)`, so any
 * failure routed through that frame would "evidence" the Connection→DataSource
 * rename regardless of what the code actually did. Only developer-facing text
 * (message, analysis) is admissible evidence.
 */
export function stripStackNoise(text: string): string {
    return text
        .replace(/\\n/g, "\n") // errors are stored JSON-escaped
        // Remove stack FRAMES surgically rather than whole lines: the evidence
        // string concatenates the error with the classifier's analysis, so
        // dropping a line would also discard prose that follows a frame.
        .replace(/\bat\s+(?:new\s+|async\s+)?[^\s(]+\s*\([^)]*\)/g, " ") // at [new] Foo.bar (…)
        .replace(/\bat\s+\S+:\d+:\d+/g, " ") // at /path:1:2
        .replace(/\S*node_modules\S*/g, " ")
        // Frames whose path was already stripped leave a bare "at [new] Name".
        .replace(/\bat\s+(?:new\s+|async\s+)?[A-Za-z_$][\w$.]*\s*(?=$|[\s"',}])/g, " ")
        .replace(/file:\/{2,}\S*/g, " ")
        .replace(/\s{2,}/g, " ");
}

const gapText = (g: GapLike): string =>
    [g.documentationGap, g.fragment, g.reasoning, g.proposedFix, g.file]
        .filter(Boolean).join(" ");

const normFragment = (g: GapLike): string =>
    String(g.fragment ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Build the evidence set for breaking-change recall.
 *
 * Recall must answer "did the pipeline SURFACE this breaking change as a
 * problem?" — so only drift-tied evidence counts:
 *   • steps that regressed (passed on old, failed on new), and
 *   • documentation gaps that are NEW in the experiment (absent from the baseline).
 *
 * CRITICAL: only the regression's `evidence` (runtime error + classifier
 * analysis) is scored — never its goal or step description. Goals are SEEDED
 * from the changelog, so their text names the changed API BY CONSTRUCTION;
 * matching against it credits a breaking change whenever a goal merely mentions
 * it. That inflated recall from 11/22 to 19/22, e.g. crediting undici's
 * "duck-typed Blob" change to a step that actually failed on the unrelated
 * handler-interface change, purely because the goal text said "blob body".
 *
 * Baseline-present gaps are excluded for the same reason — they are doc defects,
 * but not evidence of version drift.
 */
export function driftEvidenceSignals(opts: {
    stepRegressions?: RegressionLike[];
    experimentGaps?: GapLike[];
    baselineGaps?: GapLike[];
}): DetectedSignal[] {
    const baselineFragments = new Set(
        (opts.baselineGaps ?? []).map(normFragment).filter((s) => s.length > 0),
    );
    const signals: DetectedSignal[] = [];

    for (const r of opts.stepRegressions ?? []) {
        const text = stripStackNoise(r.evidence ?? "").trim();
        if (text) signals.push({ text, source: "regression" });
    }
    for (const g of opts.experimentGaps ?? []) {
        const frag = normFragment(g);
        // A gap already present on the old version is a documentation defect,
        // not drift — it cannot evidence a version-specific breaking change.
        if (frag.length > 0 && baselineFragments.has(frag)) continue;
        const text = stripStackNoise(gapText(g));
        if (text.trim()) signals.push({ text, source: "gap" });
    }
    return signals;
}

export interface BreakingChangeScore {
    total: number;
    /** Detected by ANY evidence (regression or gap) — the headline figure. */
    detected: number;
    recall: number;
    /**
     * Detected by a RUNTIME REGRESSION, i.e. the change demonstrably manifested.
     * This is the defensible number: a gap-only hit means the pipeline flagged
     * the area, not that anything broke. Report the two separately — merging
     * them is what produced the contradictory "detected, but zero regressions".
     */
    confirmed: number;
    confirmedRecall: number;
    perItem: { id: string; detected: boolean; via: "regression" | "gap" | null }[];
}

/**
 * Score which documented breaking changes the pipeline surfaced. An item counts
 * as detected when any detected signal's text contains one of its match
 * keywords (case-insensitive, word-start). Recall against the golden set is the
 * headline metric; breaking changes are the ground truth.
 */
export function scoreBreakingChanges(
    seed: ChangelogSeed,
    signals: DetectedSignal[],
): BreakingChangeScore {
    const hay = signals.map((s) => ({ text: s.text.toLowerCase(), source: s.source ?? "gap" }));
    /** Strongest source whose text contains any of the keywords, or null. */
    const match = (keywords: string[]): "regression" | "gap" | null => {
        const res = keywords.map((kw) => {
            const esc = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return new RegExp(`(^|[^a-z0-9])${esc}`, "i");
        });
        let best: "regression" | "gap" | null = null;
        for (const h of hay) {
            if (!res.some((re) => re.test(h.text))) continue;
            if (h.source === "regression") return "regression"; // strongest
            best = "gap";
        }
        return best;
    };
    const perItem = seed.breakingChanges.map((b) => {
        const via = match(b.matchKeywords);
        return { id: b.id, detected: via !== null, via };
    });
    const detected = perItem.filter((p) => p.detected).length;
    const confirmed = perItem.filter((p) => p.via === "regression").length;
    const total = perItem.length;
    return {
        total,
        detected,
        recall: total === 0 ? 0 : detected / total,
        confirmed,
        confirmedRecall: total === 0 ? 0 : confirmed / total,
        perItem,
    };
}
