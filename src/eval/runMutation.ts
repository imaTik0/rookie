#!/usr/bin/env -S deno run --allow-net --allow-env --allow-write
/**
 * runMutation.ts — the documentation MUTATION-TESTING protocol (thesis §eval).
 *
 * For each gold corpus (a fixture's corrected `fixedFiles`):
 *   Phase 0 (gold baseline): run a fresh master plan on the GOLD docs.
 *     - checks the ≥90% goal-pass-rate gold-standard requirement,
 *     - counts flagged gaps on gold docs = false-alarm baseline.
 *   Phase 1 (mutants): generate seeded first-order mutants (4 operators),
 *     for each mutant re-run ONLY the goals that can exercise the wounded
 *     fragment (planner/rerun with `goalIndices`, doc-example smoke phase
 *     skipped) against a project built from the mutated docs, then score:
 *     - detection (MDS = detected/total, per operator),
 *     - classification of detected mutants (confusion, accuracy, Cohen's κ).
 *
 * Requires the full stack (Rookie + Mongo + Qdrant + Docker + LLM backend).
 * `--dry-run` only generates and prints the mutant set (no infra needed).
 *
 * Usage:
 *   deno task eval:mutation -- --dry-run
 *   deno task eval:mutation -- --fixture rookie-eval-dayjs-missing-plugin
 *   deno task eval:mutation -- --seed 42 --per-operator 2
 *   deno task eval:mutation -- --concurrency 4                  # parallel mutants
 *   deno task eval:mutation -- --corpus gold-multilib --gold <masterPlanId>
 *                                                    # reuse a prior gold baseline
 */
import { FIXTURES } from "./fixtures.ts";
import { GOLD_CORPORA, type GoldCorpus } from "./goldCorpus.ts";
import {
    gapMatchesMutant,
    generateMutants,
    type Mutant,
    MUTATION_OPERATORS,
    parsePlannerComplete,
    type PlannerOutcome,
    relevantGoalIndices,
    siteInventory,
} from "./mutation.ts";
import { cohenKappa, confusionMatrix, type GapLabel, perLabelMetrics } from "./metrics.ts";

const BASE = Deno.env.get("ROOKIE_EVAL_BASE_URL") || "http://localhost:3000";

const argIdx = (k: string) => Deno.args.indexOf(k);
const argOf = (k: string) => (argIdx(k) !== -1 ? Deno.args[argIdx(k) + 1] ?? null : null);
const flag = (k: string) => Deno.args.includes(k);

const SEED = Number(argOf("--seed") ?? 1);
const perOpArg = argOf("--per-operator") ?? "2";
const PER_OPERATOR: number | "all" = perOpArg === "all" ? "all" : Number(perOpArg);
const ONLY_CORPUS = argOf("--corpus") ?? argOf("--fixture");
const DRY_RUN = flag("--dry-run");
/** Reuse an existing gold-baseline MASTER_PLAN report instead of re-running it. */
const GOLD_ID = argOf("--gold");
/** How many mutants run in parallel (each is an independent project). */
const CONCURRENCY = Math.max(1, Number(argOf("--concurrency") ?? "1") || 1);
const GOLD_PASS_THRESHOLD = 0.9;

// ── Rookie HTTP client (mirrors runEval.ts conventions) ──────────────────────

async function uploadFiles(
    files: { filename: string; mimetype: string; content: string }[],
): Promise<string[]> {
    const form = new FormData();
    for (const f of files) {
        form.append("files", new File([f.content], f.filename, { type: f.mimetype }));
    }
    const res = await fetch(`${BASE}/files/upload-many`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`upload failed: HTTP ${res.status}`);
    const uploaded = await res.json() as { id: string }[];
    return uploaded.map((u) => u.id);
}

async function createProject(name: string, fileIds: string[]): Promise<string> {
    const res = await fetch(`${BASE}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName: name, fileIds }),
    });
    if (!res.ok) throw new Error(`project create failed: HTTP ${res.status}`);
    return (await res.json() as { id: string }).id;
}

async function streamPlanner(endpoint: string, body: unknown): Promise<PlannerOutcome> {
    const res = await fetch(`${BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) throw new Error(`${endpoint} failed: HTTP ${res.status}`);

    let complete: Record<string, unknown> | null = null;
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += value;
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            try {
                const evt = JSON.parse(line);
                // Controller emits { type: "COMPLETE", result: <report> } — keep the
                // whole event; parsePlannerComplete reads the report under `result`.
                if (evt.type === "COMPLETE") complete = evt;
                if (evt.type === "ERROR") throw new Error(`planner ERROR: ${evt.message}`);
            } catch (e) {
                if (e instanceof SyntaxError) continue; // partial noise line
                throw e;
            }
        }
    }
    if (!complete) throw new Error("planner stream ended without COMPLETE");
    return parsePlannerComplete(complete);
}

/** Load a previously saved gold-baseline master plan (for `--gold`). */
async function fetchGoldReport(reportId: string): Promise<PlannerOutcome> {
    const res = await fetch(`${BASE}/reports/${reportId}`);
    if (!res.ok) throw new Error(`GET /reports/${reportId} failed: HTTP ${res.status}`);
    const outcome = parsePlannerComplete(await res.json() as Record<string, unknown>);
    if (!outcome.masterPlanId) outcome.masterPlanId = reportId;
    return outcome;
}

/** Run `fn` over `items` with at most `limit` in flight; preserves order. */
async function mapPool<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
): Promise<R[]> {
    const out = new Array<R>(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i]);
        }
    });
    await Promise.all(workers);
    return out;
}

// ── scoring ───────────────────────────────────────────────────────────────────

interface MutantResult {
    mutant: string;
    operator: string;
    expected: GapLabel;
    detected: boolean;
    predicted?: GapLabel;
    passRate: number;
    /** How many of the baseline goals were re-run (goal targeting). */
    goalsRun?: number;
    /** Set when the mutant run itself failed; excluded from MDS denominators. */
    error?: string;
}

function scoreMutant(mutant: Mutant, outcome: PlannerOutcome): MutantResult {
    const matches = outcome.gaps.filter((g) => gapMatchesMutant(g, mutant));
    // Prefer a location-verified match for the predicted label.
    const best = matches.find((g) => g.verified) ?? matches[0];
    return {
        mutant: mutant.id,
        operator: mutant.operator,
        expected: mutant.expectedGap,
        detected: matches.length > 0,
        predicted: best ? best.documentationGap as GapLabel : undefined,
        passRate: outcome.passRate,
    };
}

// ── main ──────────────────────────────────────────────────────────────────────

// Gold corpora: the dedicated multi-library corpus (large mutant pool) plus
// every eval fixture that ships corrected (gold) docs.
const allCorpora: GoldCorpus[] = [
    ...GOLD_CORPORA,
    ...FIXTURES
        .filter((f) => f.fixedFiles && f.fixedFiles.length > 0)
        .map((f) => ({ name: f.name, files: f.fixedFiles!, goals: f.goals })),
];
const goldCorpora = allCorpora.filter((c) => !ONLY_CORPUS || c.name === ONLY_CORPUS);

if (GOLD_ID && goldCorpora.length !== 1) {
    console.error(
        "--gold reuses one baseline for one corpus — combine it with --corpus/--fixture.",
    );
    Deno.exit(1);
}

if (goldCorpora.length === 0) {
    console.error(
        ONLY_CORPUS
            ? `Corpus "${ONLY_CORPUS}" not found. Available: ${
                allCorpora.map((c) => c.name).join(", ")
            }`
            : "No gold corpora available.",
    );
    Deno.exit(1);
}

const report: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    seed: SEED,
    perOperator: PER_OPERATOR,
    concurrency: CONCURRENCY,
    goldReused: GOLD_ID ?? undefined,
    corpora: [] as unknown[],
};

for (const corpus of goldCorpora) {
    const gold = corpus.files.map((f) => ({ filename: f.filename, content: f.content }));
    const inventory = siteInventory(gold);
    const mutants = generateMutants(gold, { seed: SEED, perOperator: PER_OPERATOR });

    console.log(`\n■ gold corpus: ${corpus.name}`);
    console.log(
        `  potential mutants: ${inventory.total} ` +
            `(DelParam ${inventory.DelParam}, DelExmpl ${inventory.DelExmpl}, ` +
            `ObfuscateType ${inventory.ObfuscateType}, AddFalseInfo ${inventory.AddFalseInfo})`,
    );
    console.log(
        `  goals: ${corpus.goals.length}, generated mutants: ${mutants.length} ` +
            `(seed ${SEED}, per-operator ${PER_OPERATOR})`,
    );
    for (const m of mutants) {
        console.log(`   · ${m.id}  [${m.operator} -> ${m.expectedGap}]  ${m.description}`);
    }
    if (DRY_RUN) continue;

    // Phase 0 — gold baseline (fresh run, or reused via --gold).
    let goldRun: PlannerOutcome;
    if (GOLD_ID) {
        console.log(`  ▸ reusing gold baseline ${GOLD_ID}…`);
        goldRun = await fetchGoldReport(GOLD_ID);
    } else {
        const goldFileIds = await uploadFiles(corpus.files);
        const goldProject = await createProject(`${corpus.name}-gold`, goldFileIds);
        console.log("  ▸ gold baseline master plan…");
        goldRun = await streamPlanner("/planner/run", {
            projectId: goldProject,
            maxGoals: corpus.goals.length,
            initialContext: "{}",
        });
    }
    const goldOk = goldRun.passRate >= GOLD_PASS_THRESHOLD;
    console.log(
        `  ${goldOk ? "✓" : "✗"} gold pass rate ${(goldRun.passRate * 100).toFixed(0)}% ` +
            `(threshold ${GOLD_PASS_THRESHOLD * 100}%), false alarms: ${goldRun.gaps.length}`,
    );
    if (!goldOk) {
        console.log("  ! gold standard not met — mutant results for this corpus are unreliable");
    }
    if (!goldRun.masterPlanId) {
        console.log("  ✗ gold run produced no masterPlanId — cannot rerun goals; skipping mutants");
        (report.corpora as unknown[]).push({
            fixture: corpus.name,
            gold: { passRate: goldRun.passRate, falseAlarms: goldRun.gaps.length, met: goldOk },
            skipped: "no masterPlanId from gold baseline",
        });
        continue;
    }
    if (!GOLD_ID) {
        console.log(`  ⓘ reuse this baseline next time: --gold ${goldRun.masterPlanId}`);
    }

    // Phase 1 — mutants via planner/rerun, targeted at the goals that can
    // exercise the wound (goalIndices) and with the doc-example smoke phase
    // skipped (no signal for any operator). One failing mutant run must not
    // abort the protocol: it is recorded as errored and excluded from MDS
    // denominators. Runs are parallelised with --concurrency.
    const runMutant = async (mutant: Mutant): Promise<MutantResult> => {
        const goalIdx = goldRun.goals.length > 0
            ? relevantGoalIndices(mutant, goldRun.goals)
            : null;
        const targetNote = goalIdx
            ? `goals [${goalIdx.join(",")}] of ${goldRun.goals.length}`
            : "all goals";
        console.log(`  ▸ mutant ${mutant.id} (${targetNote})…`);
        try {
            const fileIds = await uploadFiles(
                mutant.files.map((f) => ({ ...f, mimetype: "text/markdown" })),
            );
            const projectId = await createProject(`${corpus.name}-${mutant.id}`, fileIds);
            const outcome = await streamPlanner("/planner/rerun", {
                masterPlanId: goldRun.masterPlanId,
                projectId,
                skipDocExamples: true,
                ...(goalIdx ? { goalIndices: goalIdx } : {}),
            });
            const r: MutantResult = {
                ...scoreMutant(mutant, outcome),
                goalsRun: goalIdx?.length ?? goldRun.goals.length,
            };
            console.log(
                `    ${mutant.id}: ${
                    r.detected
                        ? `✓ detected as ${r.predicted} (expected ${r.expected})`
                        : "✗ missed"
                }`,
            );
            return r;
        } catch (e) {
            const msg = (e as Error).message.slice(0, 160);
            console.log(`    ${mutant.id}: ! errored (excluded from MDS): ${msg}`);
            return {
                mutant: mutant.id,
                operator: mutant.operator,
                expected: mutant.expectedGap,
                detected: false,
                passRate: 0,
                error: msg,
            };
        }
    };
    const results = await mapPool(mutants, CONCURRENCY, runMutant);

    // Metrics — errored runs are excluded from MDS denominators.
    const valid = results.filter((r) => !r.error);
    const errored = results.length - valid.length;
    const perOperator: Record<string, { total: number; detected: number; mds: number }> = {};
    for (const op of MUTATION_OPERATORS) {
        const rs = valid.filter((r) => r.operator === op);
        const detected = rs.filter((r) => r.detected).length;
        perOperator[op] = {
            total: rs.length,
            detected,
            mds: rs.length === 0 ? 0 : detected / rs.length,
        };
    }
    const overallMds = valid.length === 0
        ? 0
        : valid.filter((r) => r.detected).length / valid.length;

    const detectedResults = valid.filter((r) => r.detected && r.predicted);
    const goldLabels = detectedResults.map((r) => r.expected);
    const predLabels = detectedResults.map((r) => r.predicted as GapLabel);
    const kappa = cohenKappa(goldLabels, predLabels);
    const cm = confusionMatrix(goldLabels, predLabels);

    console.log(`\n  ═══ ${corpus.name} — MUTATION SCORE ═══`);
    for (const [op, s] of Object.entries(perOperator)) {
        console.log(
            `   ${op.padEnd(14)} MDS ${
                (s.mds * 100).toFixed(0).padStart(3)
            }%  (${s.detected}/${s.total})`,
        );
    }
    console.log(`   ${"OVERALL".padEnd(14)} MDS ${(overallMds * 100).toFixed(0)}%`);
    if (errored > 0) console.log(`   errored runs (excluded): ${errored}`);
    console.log(`   classification κ (detected only): ${kappa.toFixed(3)}`);

    (report.corpora as unknown[]).push({
        fixture: corpus.name,
        gold: { passRate: goldRun.passRate, falseAlarms: goldRun.gaps.length, met: goldOk },
        mutants: results,
        erroredRuns: errored,
        perOperator,
        overallMds,
        kappa,
        confusion: cm,
        perLabel: perLabelMetrics(cm),
    });
}

if (!DRY_RUN) {
    const out = `mutation-${Date.now()}.json`;
    await Deno.writeTextFile(out, JSON.stringify(report, null, 2));
    console.log(`\nReport written: ${out}`);
}
