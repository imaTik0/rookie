export type BreakingCategory = "INCORRECT" | "MISSING" | "AMBIGUOUS";

export type BreakingKind =
    | "removed"
    | "renamed"
    | "replaced"
    | "signature"
    | "behavior"
    | "default";

export interface BreakingChange {
    id: string;
    summary: string;
    oldUsageHint: string;
    kind: BreakingKind;
    expectedCategory: BreakingCategory;
    matchKeywords: string[];
}

export interface ChangelogSeed {
    pkg: string;
    oldVersion: string;
    newVersion: string;
    changelogUrl: string;
    breakingChanges: BreakingChange[];
}

export const CHANGELOG_SEEDS: Record<string, ChangelogSeed> = {
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

export interface DetectedSignal {
    text: string;
    source?: "regression" | "gap";
}

export interface GapLike {
    fragment?: unknown;
    reasoning?: unknown;
    proposedFix?: unknown;
    documentationGap?: unknown;
    file?: unknown;
}

export interface RegressionLike {
    goal?: string;
    description?: string;
    evidence?: string;
}

export function stripStackNoise(text: string): string {
    return text
        .replace(/\\n/g, "\n")
        .replace(/\bat\s+(?:new\s+|async\s+)?[^\s(]+\s*\([^)]*\)/g, " ")
        .replace(/\bat\s+\S+:\d+:\d+/g, " ")
        .replace(/\S*node_modules\S*/g, " ")
        .replace(/\bat\s+(?:new\s+|async\s+)?[A-Za-z_$][\w$.]*\s*(?=$|[\s"',}])/g, " ")
        .replace(/file:\/{2,}\S*/g, " ")
        .replace(/\s{2,}/g, " ");
}

const gapText = (g: GapLike): string =>
    [g.documentationGap, g.fragment, g.reasoning, g.proposedFix, g.file]
        .filter(Boolean).join(" ");

const normFragment = (g: GapLike): string =>
    String(g.fragment ?? "").toLowerCase().replace(/\s+/g, " ").trim();

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
        if (frag.length > 0 && baselineFragments.has(frag)) continue;
        const text = stripStackNoise(gapText(g));
        if (text.trim()) signals.push({ text, source: "gap" });
    }
    return signals;
}

export interface BreakingChangeScore {
    total: number;
    detected: number;
    recall: number;
    confirmed: number;
    confirmedRecall: number;
    perItem: { id: string; detected: boolean; via: "regression" | "gap" | null }[];
}

export function scoreBreakingChanges(
    seed: ChangelogSeed,
    signals: DetectedSignal[],
): BreakingChangeScore {
    const hay = signals.map((s) => ({ text: s.text.toLowerCase(), source: s.source ?? "gap" }));
    const match = (keywords: string[]): "regression" | "gap" | null => {
        const res = keywords.map((kw) => {
            const esc = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return new RegExp(`(^|[^a-z0-9])${esc}`, "i");
        });
        let best: "regression" | "gap" | null = null;
        for (const h of hay) {
            if (!res.some((re) => re.test(h.text))) continue;
            if (h.source === "regression") return "regression";
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
