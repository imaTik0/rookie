#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * report-all.ts — one combined view of every experiment in the sample.
 *
 * `print-report.ts` shows ONE target; this aggregates the whole study: per-target
 * goal- and step-level pass rates, drift, breaking-change recall against the
 * golden dataset, docs-faithfulness, plus sample-wide totals.
 *
 * Step-level numbers are the sensitive measure — a goal that is PARTIAL_FAILURE
 * in both phases cannot move, hiding real drift (see src/eval/stepDrift.ts) — so
 * both are reported side by side.
 *
 * Only targets in the current sample (scripts/experiments/targets.ts) are
 * included, so stale reports from earlier selections cannot leak into totals.
 * The newest report per target wins.
 *
 * Usage:
 *   deno run --allow-read --allow-write scripts/report-all.ts
 *   deno run --allow-read --allow-write scripts/report-all.ts --html results.html
 *   deno run --allow-read --allow-write scripts/report-all.ts --html results.html --open
 */
import { EXPERIMENTS } from "./experiments/targets.ts";
import { analyzeStepDrift, type GoalSteps, type StepDriftResult } from "../src/eval/stepDrift.ts";
import { renderHtml } from "./reportAllHtml.ts";

// ── CLI ───────────────────────────────────────────────────────────────────────
const arg = (k: string): string | null => {
    const i = Deno.args.indexOf(k);
    return i !== -1 ? Deno.args[i + 1] ?? null : null;
};
const HTML_OUT = arg("--html");
/** Directory holding the experiment JSONs (default: cwd) — lets an archived run be re-rendered. */
const DATA_DIR = arg("--dir") ?? "../docs_and_raports/wyniki-eksperymentow";

// ── colours (console) ─────────────────────────────────────────────────────────
const isTTY = Deno.stdout.isTerminal();
const esc = (n: string) => (s: string) => isTTY ? `\x1b[${n}m${s}\x1b[0m` : s;
const bold = esc("1"), dim = esc("2;90"), green = esc("32"), red = esc("31");
const yellow = esc("33"), cyan = esc("36"), gray = esc("90");

// ── shared types ──────────────────────────────────────────────────────────────
export interface BreakingChange {
    id: string;
    summary: string;
    kind?: string;
    expectedCategory?: string;
    oldUsageHint?: string;
    matchKeywords?: string[];
}

/** Concrete proof that a documented breaking change was surfaced by the pipeline. */
export interface DetectionEvidence {
    goal: string;
    stepIndex: number;
    stepDescription: string;
    /** The frozen program that passed on the old version and failed on the new one. */
    code?: string;
    /** Runtime error from the experiment phase. */
    error?: string;
    /** Classifier's reasoning about the documentation. */
    reasoning?: string;
    /** Proposed documentation improvement (classifier or aggregated gap). */
    suggestedFix?: string;
    /** Where the gap was pinpointed, when verified against the corpus. */
    location?: string;
}

export interface Detection {
    change: BreakingChange;
    detected: boolean;
    /** "regression" = a runtime break proves it; "gap" = flagged, but nothing broke. */
    via: "regression" | "gap" | null;
    evidence: DetectionEvidence[];
}

export interface StepView {
    stepIndex: number;
    description: string;
    baseline: string;
    experiment: string;
    /** "regression" | "improvement" | "stable" | "unpaired" */
    change: string;
    evidence?: string;
    code?: string;
    suggestedFix?: string;
}

export interface GoalView {
    goal: string;
    baselineStatus: string;
    experimentStatus: string;
    steps: StepView[];
}

/** A clustered documentation gap and the replacement text proposed for it. */
export interface GapView {
    fragment?: string;
    proposedFix?: string;
    documentationGap?: string;
    file?: string;
    lineStart?: number;
    verified?: boolean;
    occurrences?: number;
}

export interface TargetView {
    key: string;
    name: string;
    library: string;
    oldVersion: string;
    newVersion: string;
    runtime: string;
    frozen: boolean;
    timestamp: string;
    goalPass: { baseline: number; experiment: number; total: number };
    step: StepDriftResult;
    goalRegressions: number;
    recall:
        | {
            detected: number;
            /** Detected by a RUNTIME regression (the change demonstrably manifested). */
            confirmed: number;
            total: number;
            perItem: { id: string; detected: boolean; via?: "regression" | "gap" | null }[];
        }
        | null;
    breakingChanges: BreakingChange[];
    /** Breaking changes paired with the concrete drift that evidences them. */
    detections: Detection[];
    faithfulness: { checkedSteps: number; faithfulSteps: number; dodgedGoals: string[] } | null;
    /** git-apply-able unified diff of the proposed documentation fixes. */
    docsPatch: string | null;
    patchedClusters: number;
    unpatchedClusters: number;
    /** Clustered documentation gaps: current fragment → proposed replacement. */
    gaps: GapView[];
    goals: GoalView[];
    /** Set when the target's data is not trustworthy (with the reason). */
    warning?: string;
}

// ── load ──────────────────────────────────────────────────────────────────────
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();

/**
 * Errors are persisted as a serialised error object, so raw they read as
 * `{"message":"…","name":"SyntaxError","stack":"…"}` — unusable in a report.
 * Surface `name: message` plus the first few stack frames instead.
 */
function prettyError(raw: unknown): string | undefined {
    if (typeof raw !== "string" || raw.trim() === "") return undefined;
    let obj: Record<string, unknown> | null = null;
    try {
        const p = JSON.parse(raw);
        if (p && typeof p === "object") obj = p as Record<string, unknown>;
    } catch { /* plain string error */ }
    if (!obj) return raw.slice(0, 900);

    const name = obj.name ? String(obj.name) : "";
    const msg = obj.message ? String(obj.message) : "";
    const head = [name, msg].filter(Boolean).join(": ") || raw.slice(0, 200);
    const frames = typeof obj.stack === "string"
        ? obj.stack.split("\n").filter((l) => /^\s*at /.test(l)).slice(0, 3)
            .map((l) => l.trim()).join("\n")
        : "";
    const status = obj.status ?? obj.responseStatus;
    const extra = status ? `\nHTTP ${status}` : "";
    return `${head}${extra}${frames ? `\n${frames}` : ""}`.slice(0, 900);
}

/** Per-step detail beyond status, kept alongside GoalSteps for the evidence view. */
interface StepDetail {
    code?: string;
    error?: string;
    reasoning?: string;
    suggestedFix?: string;
    location?: string;
}

function toGoalSteps(
    plan: Record<string, unknown> | undefined,
    reports: Record<string, unknown>,
    details?: Map<string, StepDetail>,
): GoalSteps[] {
    const summary = plan?.structuredSummary as Record<string, unknown> | undefined;
    const breakdown = (summary?.goalsBreakdown ?? []) as Record<string, unknown>[];
    return breakdown.map((g) => {
        const goal = String(g.goal ?? "");
        const rep = reports[String(g.reportId)] as Record<string, unknown> | undefined;
        const steps = (rep?.steps ?? []) as Record<string, unknown>[];
        return {
            goal,
            steps: steps.map((s) => {
                const fa = s.failureAnalysis as Record<string, unknown> | undefined;
                const fv = fa?.fragmentVerification as Record<string, unknown> | undefined;
                const idx = Number(s.stepIndex ?? 0);
                details?.set(`${norm(goal)}#${idx}`, {
                    code: typeof s.scriptContent === "string" ? s.scriptContent : undefined,
                    error: prettyError(s.error),
                    reasoning: fa?.reasoning ? String(fa.reasoning) : undefined,
                    suggestedFix: fa?.suggestedDocsFix ? String(fa.suggestedDocsFix) : undefined,
                    location: fv?.verified && fv.file
                        ? `${fv.file}${fv.lineStart ? `:${fv.lineStart}` : ""}`
                        : undefined,
                });
                return {
                    stepIndex: idx,
                    status: String(s.status ?? "FAILED"),
                    description: String(s.stepDescription ?? ""),
                    evidence: [prettyError(s.error), fa?.reasoning]
                        .filter(Boolean).join("\n\n").slice(0, 700),
                };
            }),
        };
    });
}

/**
 * Link each documented breaking change to the concrete drift that evidences it.
 *
 * `scoreBreakingChanges` only answers detected/not; for the report we also want
 * to SHOW why. A change is matched to a regressed step when one of its
 * `matchKeywords` appears (at a word start, as in the scorer) in that step's
 * description, error or classifier reasoning.
 */
function buildDetections(
    changes: BreakingChange[],
    perItem: { id: string; detected: boolean }[],
    goals: GoalView[],
    details: Map<string, StepDetail>,
): Detection[] {
    const hit = (kw: string, hay: string): boolean => {
        const esc = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|[^a-z0-9])${esc}`, "i").test(hay);
    };
    return changes.map((change) => {
        const item = perItem.find((p) => p.id === change.id);
        const detected = item?.detected ?? false;
        const via = (item as { via?: "regression" | "gap" | null } | undefined)?.via ?? null;
        const evidence: DetectionEvidence[] = [];
        if (detected) {
            for (const g of goals) {
                for (const s of g.steps) {
                    if (s.change !== "regression") continue;
                    const d = details.get(`${norm(g.goal)}#${s.stepIndex}`) ?? {};
                    // Match on the RUNTIME evidence only — never the step
                    // description, which is derived from a changelog-seeded goal
                    // and therefore names the changed API by construction.
                    const hay = [d.error, d.reasoning].filter(Boolean).join(" ").toLowerCase();
                    if (!(change.matchKeywords ?? []).some((k) => hit(k, hay))) continue;
                    evidence.push({
                        goal: g.goal,
                        stepIndex: s.stepIndex,
                        stepDescription: s.description,
                        code: d.code,
                        error: d.error,
                        reasoning: d.reasoning,
                        suggestedFix: d.suggestedFix,
                        location: d.location,
                    });
                }
            }
        }
        // Keep the report readable: the clearest two examples per change.
        return { change, detected, via, evidence: evidence.slice(0, 2) };
    });
}

/** Newest `experiment-<key>-<ts>.json` per target key. */
function newestReports(): Map<string, string> {
    const out = new Map<string, string>();
    for (const e of Deno.readDirSync(DATA_DIR)) {
        const m = e.isFile && e.name.match(/^experiment-([a-z0-9]+)-(\d+)\.json$/);
        if (!m) continue;
        const [, key, ts] = m;
        if (!(key in EXPERIMENTS)) continue; // ignore stale selections
        const prev = out.get(key);
        if (!prev || Number(ts) > Number(prev.match(/-(\d+)\.json$/)![1])) {
            out.set(key, `${DATA_DIR}/${e.name}`);
        }
    }
    return out;
}

function loadTarget(key: string, file: string): TargetView | null {
    let r: Record<string, any>;
    try {
        r = JSON.parse(Deno.readTextFileSync(file));
    } catch {
        return null;
    }
    const bundleFile = file.replace(/\.json$/, "-full-reports.json");
    let bundle: Record<string, any> = {};
    try {
        bundle = JSON.parse(Deno.readTextFileSync(bundleFile));
    } catch { /* step detail unavailable */ }

    const reports = bundle.goalReports ?? {};
    // Baseline details give the code that WORKED; experiment details give the
    // error that broke it. Both are needed to evidence a breaking change.
    const baseDetails = new Map<string, StepDetail>();
    const expDetails = new Map<string, StepDetail>();
    const bGoals = toGoalSteps(bundle.baseline, reports, baseDetails);
    const eGoals = toGoalSteps(bundle.experiment, reports, expDetails);
    const step: StepDriftResult = r.stepDrift ?? analyzeStepDrift(bGoals, eGoals);

    // Pair goals + steps for the granular view.
    const bBreak = (r.baseline?.breakdown ?? []) as { goal: string; status: string }[];
    const eBreak = (r.experiment?.breakdown ?? []) as { goal: string; status: string }[];
    const goals: GoalView[] = bGoals.map((bg, i) => {
        const eg = eGoals.find((x) => norm(x.goal) === norm(bg.goal)) ?? eGoals[i];
        const eByIdx = new Map((eg?.steps ?? []).map((s) => [s.stepIndex, s]));
        return {
            goal: bg.goal,
            baselineStatus: bBreak.find((x) => norm(x.goal) === norm(bg.goal))?.status ??
                bBreak[i]?.status ?? "?",
            experimentStatus: eBreak.find((x) => norm(x.goal) === norm(bg.goal))?.status ??
                eBreak[i]?.status ?? "?",
            steps: bg.steps.map((bs) => {
                const es = eByIdx.get(bs.stepIndex);
                const change = !es
                    ? "unpaired"
                    : bs.status === "SUCCESS" && es.status !== "SUCCESS"
                    ? "regression"
                    : bs.status !== "SUCCESS" && es.status === "SUCCESS"
                    ? "improvement"
                    : "stable";
                const key = `${norm(bg.goal)}#${bs.stepIndex}`;
                const exp = expDetails.get(key);
                return {
                    stepIndex: bs.stepIndex,
                    description: bs.description ?? "",
                    baseline: bs.status,
                    experiment: es?.status ?? "—",
                    change,
                    // Show why it broke: prefer the experiment-side error.
                    evidence: change === "regression" ? es?.evidence : undefined,
                    // The frozen program is identical in both phases; take the
                    // baseline copy since that is the version that worked.
                    code: change === "regression"
                        ? (baseDetails.get(key)?.code ?? exp?.code)
                        : undefined,
                    suggestedFix: change === "regression" ? exp?.suggestedFix : undefined,
                };
            }),
        };
    });

    const pass = (b: { status: string }[]) => b.filter((g) => g.status === "SUCCESS").length;
    const cfg = EXPERIMENTS[key];

    // Flag targets whose data cannot be trusted.
    let warning: string | undefined;
    if (step.baseline.total === 0) warning = "no step data (bundle missing or run incomplete)";
    else if (step.baseline.passed === 0) {
        warning = "baseline never passed a step — drift is not attributable";
    }

    return {
        key,
        name: r.meta?.project ?? cfg?.name ?? key,
        library: r.meta?.library ?? cfg?.library.pkg ?? key,
        oldVersion: r.meta?.oldVersion ?? "?",
        newVersion: r.meta?.newVersion ?? "?",
        runtime: r.meta?.runtime ?? cfg?.runtime ?? "?",
        frozen: r.meta?.frozen === true,
        timestamp: r.meta?.timestamp ?? "",
        goalPass: {
            baseline: pass(bBreak),
            experiment: pass(eBreak),
            total: Math.max(bBreak.length, eBreak.length),
        },
        step,
        goalRegressions: (r.drift?.regressions ?? []).length,
        // The runner writes the patch beside the report; embed it so the HTML is
        // still a single self-contained artefact.
        docsPatch: (() => {
            const pf = r.docsPatch?.patchFile;
            if (!pf) return null;
            for (const cand of [pf, `${file.replace(/\.json$/, "")}-docs.patch`]) {
                try {
                    const txt = Deno.readTextFileSync(cand);
                    if (txt.trim()) return txt;
                } catch { /* try next */ }
            }
            return null;
        })(),
        patchedClusters: r.docsPatch?.patchedClusters ?? 0,
        unpatchedClusters: r.docsPatch?.unpatchedClusters ?? 0,
        gaps: (r.experiment?.structuredSummary?.documentationGapDetails ?? []) as GapView[],
        recall: r.changelog?.detection ?? null,
        breakingChanges: r.changelog?.goldenBreakingChanges ?? [],
        detections: buildDetections(
            r.changelog?.goldenBreakingChanges ?? [],
            r.changelog?.detection?.perItem ?? [],
            goals,
            // Merge: experiment errors/fixes win, baseline supplies the code.
            new Map(
                [...baseDetails].map((
                    [k, v],
                ) => [k, { ...v, ...expDetails.get(k), code: v.code ?? expDetails.get(k)?.code }]),
            ),
        ),
        faithfulness: r.faithfulness ?? null,
        goals,
        warning,
    };
}

// ── console output ────────────────────────────────────────────────────────────
const pctOf = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 100));
const bar = (pct: number, w = 12) => {
    const f = Math.round((pct / 100) * w);
    const c = pct >= 70 ? green : pct >= 40 ? yellow : red;
    return c("█".repeat(f)) + gray("░".repeat(w - f));
};

function printConsole(targets: TargetView[]): void {
    console.log(`\n${bold("═".repeat(96))}`);
    console.log(bold("  DOCUMENTATION-DRIFT STUDY — ALL EXPERIMENTS"));
    console.log(bold("═".repeat(96)));

    console.log(
        `\n  ${dim("target".padEnd(11))}${dim("versions".padEnd(18))}${
            dim("goals b→e".padEnd(12))
        }` +
            `${dim("steps b→e".padEnd(24))}${dim("drift".padEnd(8))}${dim("detect".padEnd(8))}${
                dim("confirm".padEnd(10))
            }${dim("dodge")}`,
    );
    console.log(`  ${gray("─".repeat(92))}`);

    for (const t of targets) {
        const bp = pctOf(t.step.baseline.passed, t.step.baseline.total);
        const ep = pctOf(t.step.experiment.passed, t.step.experiment.total);
        const steps = `${bar(bp, 8)} ${String(bp).padStart(3)}%→${
            (ep < bp ? red : green)(`${String(ep).padStart(3)}%`)
        }`;
        const drift = t.step.regressions.length > 0
            ? red(`-${t.step.regressions.length}`.padEnd(4))
            : gray("  0 ");
        const rec = t.recall ? `${t.recall.detected}/${t.recall.total}` : "—";
        const conf = t.recall ? `${t.recall.confirmed ?? 0}/${t.recall.total}` : "—";
        const dodge = t.faithfulness
            ? `${t.faithfulness.faithfulSteps}/${t.faithfulness.checkedSteps}`
            : "—";
        console.log(
            `  ${t.key.padEnd(11)}${`${t.oldVersion}→${t.newVersion}`.padEnd(18)}` +
                `${
                    `${t.goalPass.baseline}/${t.goalPass.total}→${t.goalPass.experiment}/${t.goalPass.total}`
                        .padEnd(12)
                }` +
                `${steps}   ${drift}    ${rec.padEnd(8)}${conf.padEnd(10)}${dodge}` +
                (t.warning ? `  ${yellow("⚠")}` : ""),
        );
    }

    // ── sample-wide totals ────────────────────────────────────────────
    const valid = targets.filter((t) => !t.warning);
    const sum = (f: (t: TargetView) => number, list = targets) =>
        list.reduce((a, t) => a + f(t), 0);
    const bTot = sum((t) => t.step.baseline.total), bPass = sum((t) => t.step.baseline.passed);
    const eTot = sum((t) => t.step.experiment.total), ePass = sum((t) => t.step.experiment.passed);
    const regr = sum((t) => t.step.regressions.length);
    const impr = sum((t) => t.step.improvements.length);
    const recD = sum((t) => t.recall?.detected ?? 0), recT = sum((t) => t.recall?.total ?? 0);
    const recC = sum((t) => t.recall?.confirmed ?? 0);

    console.log(`\n  ${bold("SAMPLE TOTALS")}  ${dim(`(${targets.length} targets)`)}`);
    console.log(`  ${gray("─".repeat(92))}`);
    console.log(
        `  ${"steps passed".padEnd(24)}${bPass}/${bTot} (${pctOf(bPass, bTot)}%) baseline  →  ` +
            `${ePass}/${eTot} (${pctOf(ePass, eTot)}%) experiment`,
    );
    console.log(
        `  ${"step regressions".padEnd(24)}${bold(red(String(regr)))}` +
            `   ${dim(`(improvements: ${impr} — frozen code, so these are flakiness)`)}`,
    );
    console.log(
        `  ${"BC confirmed".padEnd(24)}${bold(`${recC}/${recT}`)} (${pctOf(recC, recT)}%)  ` +
            dim("proven by a runtime break on the new version"),
    );
    console.log(
        `  ${"BC detected (any)".padEnd(24)}${recD}/${recT} (${pctOf(recD, recT)}%)  ` +
            dim("flagged as a doc gap, but nothing demonstrably broke"),
    );
    console.log(
        `  ${"targets with drift".padEnd(24)}${
            targets.filter((t) => t.step.regressions.length > 0).length
        }/${targets.length}` +
            `   ${dim(`(${valid.length} with a usable baseline)`)}`,
    );

    const flagged = targets.filter((t) => t.warning);
    if (flagged.length > 0) {
        console.log(`\n  ${yellow("⚠ EXCLUDE FROM CONCLUSIONS")}`);
        for (const t of flagged) console.log(`    ${t.key.padEnd(11)} ${dim(t.warning!)}`);
    }

    // ── missed breaking changes ───────────────────────────────────────
    const missed = targets.flatMap((t) =>
        (t.recall?.perItem ?? []).filter((p) => !p.detected).map((p) => `${t.key}: ${p.id}`)
    );
    if (missed.length > 0) {
        console.log(`\n  ${bold("Breaking changes NOT detected")} ${dim(`(${missed.length})`)}`);
        for (const m of missed) console.log(`    ${gray("·")} ${m}`);
    }
    console.log();
}

// ── main ──────────────────────────────────────────────────────────────────────
const files = newestReports();
if (files.size === 0) {
    console.error("No experiment reports found for the current sample (run one first).");
    Deno.exit(1);
}
const targets = [...files]
    .map(([k, f]) => loadTarget(k, f))
    .filter((t): t is TargetView => t !== null)
    .sort((a, b) =>
        (EXPERIMENTS[a.key]?.selectionRank ?? 99) - (EXPERIMENTS[b.key]?.selectionRank ?? 99)
    );

printConsole(targets);

if (HTML_OUT) {
    Deno.writeTextFileSync(HTML_OUT, renderHtml(targets));
    console.log(`  ${cyan("HTML written:")} ${bold(HTML_OUT)}\n`);
}
