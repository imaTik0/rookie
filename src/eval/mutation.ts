/**
 * Documentation mutation engine — the four operators from the thesis protocol
 * (MuTAP-style, applied to DOCUMENTATION instead of code):
 *
 *   DelParam       remove a required parameter/header description  -> MISSING
 *   DelExmpl       remove a fenced request/response example block  -> MISSING
 *   ObfuscateType  replace a precise type with generic `string`    -> AMBIGUOUS
 *   AddFalseInfo   insert a plausible but nonexistent parameter    -> INCORRECT
 *
 * Given a gold-standard corpus, `generateMutants` produces first-order mutants
 * (exactly ONE mutation each) with ground-truth records: operator, expected gap
 * category, wound location in MUTATED-file coordinates, and match keywords.
 * Site selection is seeded-deterministic so runs are reproducible.
 *
 * Pure & dependency-free — unit-tested in mutation.test.ts. The infra-driving
 * orchestration lives in runMutation.ts.
 */
import type { GapLabel } from "./metrics.ts";

export type MutationOperator = "DelParam" | "DelExmpl" | "ObfuscateType" | "AddFalseInfo";

export const MUTATION_OPERATORS: MutationOperator[] = [
    "DelParam",
    "DelExmpl",
    "ObfuscateType",
    "AddFalseInfo",
];

export const EXPECTED_GAP: Record<MutationOperator, GapLabel> = {
    DelParam: "MISSING",
    DelExmpl: "MISSING",
    ObfuscateType: "AMBIGUOUS",
    AddFalseInfo: "INCORRECT",
};

export interface DocFileIn {
    filename: string;
    content: string;
}

/** A candidate location where an operator can be applied. */
export interface MutationSite {
    operator: MutationOperator;
    file: string;
    /** 1-based line range affected in the ORIGINAL file. */
    lineStart: number;
    lineEnd: number;
    /** For ObfuscateType: which type occurrence on the line to replace (1-based). */
    occurrence?: number;
    /** Human-readable description of what would change. */
    description: string;
    /** Substrings expected to appear in a correct failure analysis. */
    matchKeywords: string[];
    /**
     * Hints for GOAL TARGETING only (section identifier / heading near the
     * wound). Deliberately separate from `matchKeywords`, which define
     * detection ground truth — mixing them would loosen MDS matching.
     */
    goalHints?: string[];
}

export interface Mutant {
    /** Stable id: <operator>-<file>-L<line>. */
    id: string;
    operator: MutationOperator;
    expectedGap: GapLabel;
    file: string;
    /** 1-based wound location in the MUTATED file (where the gap now "lives"). */
    woundLine: number;
    description: string;
    matchKeywords: string[];
    /** See MutationSite.goalHints — used only to pick relevant goals. */
    goalHints?: string[];
    /** Full corpus with exactly this one mutation applied. */
    files: DocFileIn[];
}

// ── deterministic PRNG (mulberry32) ───────────────────────────────────────────

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Deterministic in-place shuffle. */
function shuffle<T>(xs: T[], rand: () => number): T[] {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ── site enumeration ──────────────────────────────────────────────────────────

/** `- \`name\` (string, required): …` or `* \`X-Header\` — required …` */
const PARAM_LINE_RE =
    /^\s*[-*]\s+`([^`]+)`.*?(string|number|integer|boolean|required|optional|header|token)/i;

/** Bold definition style: `**\`name\`** (type…): …` */
const PARAM_BOLD_RE = /^\s*\*\*`([^`]+)`\*\*.*?(string|number|integer|boolean|required|optional)/i;

/** Table row that looks like a parameter row: | `name` | type | ... */
const PARAM_ROW_RE = /^\s*\|\s*`?(\w[\w-]*)`?\s*\|.*(string|number|integer|boolean|required)/i;

// Covers parameter types AND return-value sentences ("Returns a number …") —
// every occurrence outside code fences is a distinct ObfuscateType site.
const PRECISE_TYPE_RE = /\b(number|integer|boolean|float|ISO[- ]?8601|timestamp|array of \w+)\b/;
const PRECISE_TYPE_RE_G = new RegExp(PRECISE_TYPE_RE.source, "g");

const IDENT_RE = /\b([A-Za-z_$][\w$]*)\s*\(/;

function fenceBlocks(lines: string[]): { start: number; end: number }[] {
    const blocks: { start: number; end: number }[] = [];
    let open = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^\s*```/.test(lines[i])) {
            if (open === -1) open = i;
            else {
                blocks.push({ start: open, end: i });
                open = -1;
            }
        }
    }
    return blocks;
}

function nearestHeading(lines: string[], idx: number): string | undefined {
    for (let i = idx; i >= 0; i--) {
        const m = lines[i].match(/^#{1,6}\s+(.*)/);
        if (m) return m[1].trim();
    }
    return undefined;
}

/** Goal-targeting hints for a site: the section's function ident, else the heading text. */
function goalHintsFor(lines: string[], idx: number): string[] {
    const heading = nearestHeading(lines, idx);
    if (!heading) return [];
    const ident = heading.match(IDENT_RE)?.[1];
    return ident ? [ident] : [heading];
}

/** Heading-style documented option, e.g. `#### options.timeout` or `### \`cwd\``. */
const HEADING_OPT_RE = /^#{2,6}\s+`?([A-Za-z_$][\w$.]*)`?\s*$/;
/** A "Type:" line (sindresorhus/execa style: `_Type:_ \`number\``, or `Type: \`x\``,
 *  or `**Type**: \`x\``) marking the heading above as a documented option. The
 *  markdown emphasis can wrap `Type:` (colon inside the italics), so underscores
 *  / asterisks may appear on both sides of the colon. */
const TYPE_LINE_RE = /^\s*[_*]{0,2}(type|default)[_*]{0,2}\s*[:：][_*]{0,2}\s*`/i;

/** True when one of the next few non-empty lines documents a type (⇒ the heading is a real option). */
function headingIsOption(lines: string[], idx: number): boolean {
    let seen = 0;
    for (let j = idx + 1; j < lines.length && seen < 3; j++) {
        if (lines[j].trim() === "") continue;
        seen++;
        if (TYPE_LINE_RE.test(lines[j])) return true;
        if (/^#{1,6}\s/.test(lines[j])) return false; // next heading ⇒ not an option block
    }
    return false;
}

/** Enumerate every applicable mutation site in the corpus. */
export function enumerateSites(files: DocFileIn[]): MutationSite[] {
    const sites: MutationSite[] = [];

    for (const file of files) {
        if (!/\.(md|mdx|txt|rst)$/i.test(file.filename)) continue;
        const lines = file.content.split("\n");
        const blocks = fenceBlocks(lines);
        const inFence = (i: number) => blocks.some((b) => i >= b.start && i <= b.end);

        for (let i = 0; i < lines.length; i++) {
            if (inFence(i)) continue;
            const line = lines[i];

            // DelParam — a parameter/header description line (three styles).
            const pm = line.match(PARAM_LINE_RE) ?? line.match(PARAM_BOLD_RE) ??
                line.match(PARAM_ROW_RE);
            if (pm) {
                const hints = goalHintsFor(lines, i);
                sites.push({
                    operator: "DelParam",
                    file: file.filename,
                    lineStart: i + 1,
                    lineEnd: i + 1,
                    description: `delete description of \`${pm[1]}\``,
                    matchKeywords: [pm[1]],
                    goalHints: hints,
                });
                // AddFalseInfo — insert a fake sibling parameter right after a real one.
                sites.push({
                    operator: "AddFalseInfo",
                    file: file.filename,
                    lineStart: i + 1,
                    lineEnd: i + 1,
                    description: `insert fake parameter after \`${pm[1]}\``,
                    matchKeywords: ["xVerifyMode"],
                    goalHints: hints,
                });
            }

            // DelParam / AddFalseInfo — heading-style option docs common in real
            // API references (`#### options.timeout` followed by a `Type:` line).
            const hm = line.match(HEADING_OPT_RE);
            if (hm && headingIsOption(lines, i)) {
                const opt = hm[1];
                const short = opt.split(".").pop() || opt;
                const hints = [short];
                sites.push({
                    operator: "DelParam",
                    file: file.filename,
                    lineStart: i + 1,
                    lineEnd: i + 1,
                    description: `delete documented option \`${opt}\``,
                    matchKeywords: [opt, short],
                    goalHints: hints,
                });
                sites.push({
                    operator: "AddFalseInfo",
                    file: file.filename,
                    lineStart: i + 1,
                    lineEnd: i + 1,
                    description: `insert fake option after \`${opt}\``,
                    matchKeywords: ["xVerifyMode"],
                    goalHints: hints,
                });
            }

            // ObfuscateType — EVERY precise type mentioned outside code fences
            // (multiple occurrences on one line are distinct sites), plus
            // return-value sentences ("Returns a number …").
            const typeMatches = [...line.matchAll(PRECISE_TYPE_RE_G)];
            for (let occ = 0; occ < typeMatches.length; occ++) {
                const param = line.match(/`([^`]+)`/)?.[1];
                sites.push({
                    operator: "ObfuscateType",
                    file: file.filename,
                    lineStart: i + 1,
                    lineEnd: i + 1,
                    occurrence: occ + 1,
                    description: `replace type "${typeMatches[occ][1]}" with "string"` +
                        (typeMatches.length > 1 ? ` (occurrence ${occ + 1})` : ""),
                    matchKeywords: [param ?? typeMatches[occ][1], "string"]
                        .filter(Boolean) as string[],
                    goalHints: goalHintsFor(lines, i),
                });
            }
        }

        // DelExmpl — every fenced example block (with its fences).
        for (const b of blocks) {
            const code = lines.slice(b.start + 1, b.end).join("\n");
            if (code.trim().length < 10) continue;
            const ident = code.match(IDENT_RE)?.[1];
            const heading = nearestHeading(lines, b.start);
            sites.push({
                operator: "DelExmpl",
                file: file.filename,
                lineStart: b.start + 1,
                lineEnd: b.end + 1,
                description: `delete example block under "${heading ?? "?"}"`,
                matchKeywords: [ident, heading].filter(Boolean) as string[],
                goalHints: [ident, ...goalHintsFor(lines, b.start)]
                    .filter(Boolean) as string[],
            });
        }
    }
    return sites;
}

// ── mutant generation ─────────────────────────────────────────────────────────

const FAKE_PARAM_LINE =
    '- `xVerifyMode` (string, required): verification mode for this call — must be set to `"strict"`, otherwise the request is rejected.';

/** Apply one site to the corpus; returns mutated files + wound line (mutated coords). */
export function applySite(files: DocFileIn[], site: MutationSite): {
    files: DocFileIn[];
    woundLine: number;
} {
    const out = files.map((f) => ({ ...f }));
    const target = out.find((f) => f.filename === site.file)!;
    const lines = target.content.split("\n");
    const idx = site.lineStart - 1;

    switch (site.operator) {
        case "DelParam": {
            lines.splice(idx, 1);
            target.content = lines.join("\n");
            // Wound sits where the line used to be (now the next line).
            return { files: out, woundLine: Math.min(site.lineStart, lines.length) };
        }
        case "DelExmpl": {
            lines.splice(idx, site.lineEnd - site.lineStart + 1);
            target.content = lines.join("\n");
            return { files: out, woundLine: Math.min(site.lineStart, lines.length) };
        }
        case "ObfuscateType": {
            // Replace exactly the site's occurrence (1-based) on the line.
            const wanted = site.occurrence ?? 1;
            let seen = 0;
            lines[idx] = lines[idx].replace(
                PRECISE_TYPE_RE_G,
                (match) => (++seen === wanted ? "string" : match),
            );
            target.content = lines.join("\n");
            return { files: out, woundLine: site.lineStart };
        }
        case "AddFalseInfo": {
            lines.splice(idx + 1, 0, FAKE_PARAM_LINE);
            target.content = lines.join("\n");
            return { files: out, woundLine: site.lineStart + 1 };
        }
    }
}

export interface GenerateOptions {
    /** PRNG seed — same seed + corpus => identical mutant set. */
    seed?: number;
    /** Mutants per operator: a number, or "all" for one mutant per site (default 2). */
    perOperator?: number | "all";
}

/** Per-operator counts of applicable sites — the size of the potential mutant pool. */
export function siteInventory(files: DocFileIn[]): Record<MutationOperator, number> & {
    total: number;
} {
    const sites = enumerateSites(files);
    const counts = Object.fromEntries(
        MUTATION_OPERATORS.map((op) => [op, sites.filter((s) => s.operator === op).length]),
    ) as Record<MutationOperator, number>;
    return { ...counts, total: sites.length };
}

/** Generate a reproducible set of first-order mutants from a gold corpus. */
export function generateMutants(files: DocFileIn[], opts: GenerateOptions = {}): Mutant[] {
    const seed = opts.seed ?? 1;
    const perOperator = opts.perOperator ?? 2;
    const rand = mulberry32(seed);

    const all = enumerateSites(files);
    const mutants: Mutant[] = [];

    for (const op of MUTATION_OPERATORS) {
        const pool = shuffle(all.filter((s) => s.operator === op), rand);
        const sites = perOperator === "all" ? pool : pool.slice(0, perOperator);
        for (const site of sites) {
            const { files: mutated, woundLine } = applySite(files, site);
            mutants.push({
                id: `${op}-${site.file}-L${site.lineStart}` +
                    (site.occurrence && site.occurrence > 1 ? `-o${site.occurrence}` : ""),
                operator: op,
                expectedGap: EXPECTED_GAP[op],
                file: site.file,
                woundLine,
                description: site.description,
                matchKeywords: site.matchKeywords,
                goalHints: site.goalHints,
                files: mutated,
            });
        }
    }
    return mutants;
}

// ── detection matching (shared by the driver and its tests) ───────────────────

export interface ReportedGap {
    documentationGap: string;
    reasoning?: string;
    suggestedDocsFix?: string;
    fragment?: string;
    file?: string;
    lineStart?: number;
    lineEnd?: number;
    verified?: boolean;
}

/** Line tolerance when matching a verified fragment to the wound. */
export const WOUND_TOLERANCE_LINES = 8;

/**
 * True when a reported gap matches the mutant's ground truth: either the
 * verified fragment overlaps the wound (same file, ±tolerance lines), or the
 * analysis text mentions one of the match keywords.
 */
export function gapMatchesMutant(gap: ReportedGap, mutant: Mutant): boolean {
    if (
        gap.verified && gap.file === mutant.file &&
        gap.lineStart !== undefined && gap.lineEnd !== undefined
    ) {
        const lo = gap.lineStart - WOUND_TOLERANCE_LINES;
        const hi = gap.lineEnd + WOUND_TOLERANCE_LINES;
        if (mutant.woundLine >= lo && mutant.woundLine <= hi) return true;
    }
    const text = [gap.reasoning, gap.suggestedDocsFix, gap.fragment]
        .filter(Boolean).join(" ").toLowerCase();
    return mutant.matchKeywords.some((k) => text.includes(k.toLowerCase()));
}

// ── goal targeting ────────────────────────────────────────────────────────────

/** Case-insensitive match of `needle` at a word start ("chunk" matches "chunks"). */
function containsToken(haystack: string, needle: string): boolean {
    const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${esc}`, "i").test(haystack);
}

/**
 * Map a mutant to the goal indices (0-based) that can plausibly exercise its
 * wounded fragment, so the driver can re-run ONLY those goals:
 *
 *   1. restrict to goals mentioning the wounded file's stem (library name),
 *   2. within that pool, prefer goals mentioning a `goalHints` token
 *      (the section's function identifier).
 *
 * Every stage falls back to the wider pool instead of returning an empty
 * selection — targeting reduces cost but must never remove the only goal that
 * could detect the wound.
 */
export function relevantGoalIndices(
    mutant: Pick<Mutant, "file" | "goalHints">,
    goals: string[],
): number[] {
    const all = goals.map((_, i) => i);
    if (goals.length <= 1) return all;

    const stem = mutant.file.replace(/\.[^.]*$/, "");
    const byFile = all.filter((i) => containsToken(goals[i], stem));
    const pool = byFile.length > 0 ? byFile : all;

    const hints = (mutant.goalHints ?? []).filter((h) => h.length >= 2);
    const byHint = pool.filter((i) => hints.some((h) => containsToken(goals[i], h)));
    return byHint.length > 0 ? byHint : pool;
}

// ── planner COMPLETE event parsing ────────────────────────────────────────────

export interface PlannerOutcome {
    masterPlanId: string;
    passRate: number;
    gaps: ReportedGap[];
    /** Saved goal texts (`masterPlanGoals`) — used for mutant→goal targeting. */
    goals: string[];
}

/**
 * Parse the terminal NDJSON event of `/planner/run` / `/planner/rerun`.
 *
 * The controller emits `{ type: "COMPLETE", result: <master-plan report> }`
 * (see PlannerController: `stream.writeln(JSON.stringify({ type: "COMPLETE",
 * result }))`), so the report — with `_id` and `structuredSummary` — lives
 * under `result`. Reading the wrapper itself yields an empty masterPlanId and
 * a 0% pass rate; this function is unit-tested against the real shape to
 * prevent that regression.
 */
export function parsePlannerComplete(evt: Record<string, unknown>): PlannerOutcome {
    const report = (evt.result ?? evt) as Record<string, unknown>;
    const summary = report.structuredSummary as Record<string, unknown> | undefined;
    const breakdown = (summary?.goalsBreakdown ?? []) as { status: string }[];
    const passRate = breakdown.length === 0
        ? 0
        : breakdown.filter((g) => g.status === "SUCCESS").length / breakdown.length;
    const details = (summary?.documentationGapDetails ?? []) as Record<string, unknown>[];
    const gaps: ReportedGap[] = details.map((d) => ({
        documentationGap: String(d.documentationGap ?? "UNKNOWN"),
        fragment: d.fragment as string | undefined,
        suggestedDocsFix: d.proposedFix as string | undefined,
        file: d.file as string | undefined,
        lineStart: d.lineStart as number | undefined,
        lineEnd: d.lineEnd as number | undefined,
        verified: d.verified as boolean | undefined,
    }));
    return {
        masterPlanId: String(report._id ?? report.id ?? ""),
        passRate,
        gaps,
        goals: (report.masterPlanGoals ?? []) as string[],
    };
}
