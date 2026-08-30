#!/usr/bin/env -S deno run --allow-net --allow-env --allow-write
import { type GoldCorpus } from "./goldCorpus.ts";
import { fetchMutationCorpus } from "./mutationCorpus.ts";
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
const DRY_RUN = flag("--dry-run");
const GOLD_ID = argOf("--gold");
const CONCURRENCY = Math.max(1, Number(argOf("--concurrency") ?? "1") || 1);
const LIBRARY = argOf("--library") ?? "marked";
const GOLD_PASS_THRESHOLD = 0.9;

let PACKAGE_OVERRIDES: Record<string, string> | undefined;

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
                if (evt.type === "COMPLETE") complete = evt;
                if (evt.type === "ERROR") throw new Error(`planner ERROR: ${evt.message}`);
            } catch (e) {
                if (e instanceof SyntaxError) continue;
                throw e;
            }
        }
    }
    if (!complete) throw new Error("planner stream ended without COMPLETE");
    return parsePlannerComplete(complete);
}

async function fetchGoldReport(reportId: string): Promise<PlannerOutcome> {
    const res = await fetch(`${BASE}/reports/${reportId}`);
    if (!res.ok) throw new Error(`GET /reports/${reportId} failed: HTTP ${res.status}`);
    const outcome = parsePlannerComplete(await res.json() as Record<string, unknown>);
    if (!outcome.masterPlanId) outcome.masterPlanId = reportId;
    return outcome;
}

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

interface MutantResult {
    mutant: string;
    operator: string;
    expected: GapLabel;
    detected: boolean;
    predicted?: GapLabel;
    passRate: number;
    goalsRun?: number;
    error?: string;
}

function scoreMutant(mutant: Mutant, outcome: PlannerOutcome): MutantResult {
    const matches = outcome.gaps.filter((g) => gapMatchesMutant(g, mutant));
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

const fetched = await fetchMutationCorpus(LIBRARY);
const goldCorpora: GoldCorpus[] = [fetched.corpus];
PACKAGE_OVERRIDES = { [fetched.pkg]: fetched.version };
console.log(
    `Post-cutoff mutation corpus: ${fetched.corpus.name} ` +
        `(${fetched.corpus.files.length} doc files, pinned ${fetched.pkg}@${fetched.version})`,
);

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
            packageOverrides: PACKAGE_OVERRIDES,
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
                packageOverrides: PACKAGE_OVERRIDES,
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
        gold: {
            masterPlanId: goldRun.masterPlanId,
            passRate: goldRun.passRate,
            falseAlarms: goldRun.gaps.length,
            met: goldOk,
        },
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
