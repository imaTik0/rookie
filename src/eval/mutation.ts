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

export interface MutationSite {
    operator: MutationOperator;
    file: string;
    lineStart: number;
    lineEnd: number;
    occurrence?: number;
    description: string;
    matchKeywords: string[];
    goalHints?: string[];
}

export interface Mutant {
    id: string;
    operator: MutationOperator;
    expectedGap: GapLabel;
    file: string;
    woundLine: number;
    description: string;
    matchKeywords: string[];
    goalHints?: string[];
    files: DocFileIn[];
}

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

function shuffle<T>(xs: T[], rand: () => number): T[] {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

const PARAM_LINE_RE =
    /^\s*[-*]\s+`([^`]+)`.*?(string|number|integer|boolean|required|optional|header|token)/i;

const PARAM_BOLD_RE = /^\s*\*\*`([^`]+)`\*\*.*?(string|number|integer|boolean|required|optional)/i;

const PARAM_ROW_RE = /^\s*\|\s*`?(\w[\w-]*)`?\s*\|.*(string|number|integer|boolean|required)/i;

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

function goalHintsFor(lines: string[], idx: number): string[] {
    const heading = nearestHeading(lines, idx);
    if (!heading) return [];
    const ident = heading.match(IDENT_RE)?.[1];
    return ident ? [ident] : [heading];
}

const HEADING_OPT_RE = /^#{2,6}\s+`?([A-Za-z_$][\w$.]*)`?\s*$/;
const TYPE_LINE_RE = /^\s*[_*]{0,2}(type|default)[_*]{0,2}\s*[:：][_*]{0,2}\s*`/i;

function headingIsOption(lines: string[], idx: number): boolean {
    let seen = 0;
    for (let j = idx + 1; j < lines.length && seen < 3; j++) {
        if (lines[j].trim() === "") continue;
        seen++;
        if (TYPE_LINE_RE.test(lines[j])) return true;
        if (/^#{1,6}\s/.test(lines[j])) return false;
    }
    return false;
}

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

const FAKE_PARAM_LINE =
    '- `xVerifyMode` (string, required): verification mode for this call — must be set to `"strict"`, otherwise the request is rejected.';

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
            return { files: out, woundLine: Math.min(site.lineStart, lines.length) };
        }
        case "DelExmpl": {
            lines.splice(idx, site.lineEnd - site.lineStart + 1);
            target.content = lines.join("\n");
            return { files: out, woundLine: Math.min(site.lineStart, lines.length) };
        }
        case "ObfuscateType": {
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
    seed?: number;
    perOperator?: number | "all";
}

export function siteInventory(files: DocFileIn[]): Record<MutationOperator, number> & {
    total: number;
} {
    const sites = enumerateSites(files);
    const counts = Object.fromEntries(
        MUTATION_OPERATORS.map((op) => [op, sites.filter((s) => s.operator === op).length]),
    ) as Record<MutationOperator, number>;
    return { ...counts, total: sites.length };
}

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

export const WOUND_TOLERANCE_LINES = 8;

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

function containsToken(haystack: string, needle: string): boolean {
    const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${esc}`, "i").test(haystack);
}

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

export interface PlannerOutcome {
    masterPlanId: string;
    passRate: number;
    gaps: ReportedGap[];
    goals: string[];
}

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
