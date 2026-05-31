/**
 * End-to-end evaluation runner.
 *
 * Drives a RUNNING Rookie instance over its HTTP API for each labelled fixture,
 * then scores documentation-gap DETECTION and CLASSIFICATION against the ground
 * truth in fixtures.ts.
 *
 * Prerequisites: a running Rookie server (`deno task start`) plus its
 * dependencies (MongoDB, Qdrant, Docker) and a configured LLM/embeddings backend
 * (OpenAI or a local Ollama/llama.cpp endpoint — see README).
 *
 * Run:  deno run --allow-net --allow-env src/eval/runEval.ts
 * Env:  ROOKIE_EVAL_BASE_URL (default http://localhost:3000)
 *
 * This is an INTEGRATION evaluation: results depend on the model. Run it a few
 * times / with several models to compare. The pure metric maths is unit-tested
 * separately in metrics.test.ts.
 */
import { EvalFixture, FIXTURES } from "./fixtures.ts";
import {
    cohenKappa,
    confusionMatrix,
    detectionMetrics,
    GapLabel,
    macroF1,
    perLabelMetrics,
} from "./metrics.ts";

const BASE = Deno.env.get("ROOKIE_EVAL_BASE_URL") || "http://localhost:3000";

interface StepLike {
    status: string;
    failureAnalysis?: {
        documentationGap: GapLabel;
        failedFunction?: string;
        reasoning?: string;
        pinpointedFragment?: string;
    };
}
interface ReportLike {
    status: string;
    steps: StepLike[];
}

async function uploadFiles(fixture: EvalFixture): Promise<string[]> {
    const form = new FormData();
    for (const f of fixture.files) {
        form.append("files", new File([f.content], f.filename, { type: f.mimetype }));
    }
    const res = await fetch(`${BASE}/files/upload-many`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`upload-many failed: ${res.status} ${await res.text()}`);
    const arr = await res.json();
    return arr.map((f: any) => f.id);
}

async function createProject(name: string, fileIds: string[]): Promise<string> {
    const res = await fetch(`${BASE}/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectName: name, fileIds }),
    });
    if (!res.ok) throw new Error(`create project failed: ${res.status} ${await res.text()}`);
    return (await res.json()).id;
}

/** Consume the NDJSON master-plan stream and collect the produced report ids. */
async function runMasterPlan(projectId: string, maxGoals: number): Promise<string[]> {
    const res = await fetch(`${BASE}/planner/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, maxGoals, initialContext: "{}" }),
    });
    if (!res.ok || !res.body) {
        throw new Error(`planner/run failed: ${res.status} ${await res.text()}`);
    }
    const reportIds = new Set<string>();
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const evt = JSON.parse(line);
                if (evt.reportId) reportIds.add(evt.reportId);
            } catch { /* progress log line, ignore */ }
        }
    }
    return [...reportIds];
}

async function getReport(reportId: string): Promise<ReportLike | null> {
    const res = await fetch(`${BASE}/reports/${reportId}`);
    if (!res.ok) return null;
    return await res.json();
}

function failureText(s: StepLike): string {
    const fa = s.failureAnalysis;
    if (!fa) return "";
    return [fa.failedFunction, fa.reasoning, fa.pinpointedFragment].filter(Boolean).join(" ")
        .toLowerCase();
}

async function main() {
    const goldLabels: GapLabel[] = [];
    const predLabels: GapLabel[] = [];
    let detected = 0;
    let totalGold = 0;
    let totalFlagged = 0;
    let goalsPassed = 0;
    let goalsTotal = 0;

    for (const fixture of FIXTURES) {
        console.log(`\n=== Fixture: ${fixture.name} ===`);
        try {
            const fileIds = await uploadFiles(fixture);
            const projectId = await createProject(fixture.name, fileIds);
            const reportIds = await runMasterPlan(projectId, fixture.goals.length);
            const reports = (await Promise.all(reportIds.map(getReport))).filter(
                (r): r is ReportLike => !!r,
            );

            const allFailures = reports.flatMap((r) =>
                r.steps.filter((s) => s.status === "FAILED" && s.failureAnalysis)
            );
            // Documentation-gap flags exclude ENVIRONMENT (tooling, not docs).
            const docFailures = allFailures.filter(
                (s) => s.failureAnalysis!.documentationGap !== "ENVIRONMENT",
            );
            totalFlagged += docFailures.length;

            goalsTotal += reports.length;
            goalsPassed += reports.filter((r) => r.status === "SUCCESS").length;

            for (const defect of fixture.expectedDefects) {
                totalGold++;
                const kw = defect.matchKeywords.map((k) => k.toLowerCase());
                const match = docFailures.find((s) => {
                    const t = failureText(s);
                    return kw.some((k) => t.includes(k));
                });
                if (match) {
                    detected++;
                    goldLabels.push(defect.expectedGap);
                    predLabels.push(match.failureAnalysis!.documentationGap);
                    console.log(
                        `  [DETECTED] ${defect.id}: expected=${defect.expectedGap} ` +
                            `predicted=${match.failureAnalysis!.documentationGap}`,
                    );
                } else {
                    console.log(`  [MISSED]   ${defect.id} (expected ${defect.expectedGap})`);
                }
            }
        } catch (err) {
            console.error(`  Fixture failed to run: ${(err as Error).message}`);
        }
    }

    // ─── Report ──────────────────────────────────────────────────────────────
    console.log("\n========== EVALUATION SUMMARY ==========");
    const det = detectionMetrics(detected, totalGold, totalFlagged);
    console.log(
        `Gap detection: precision=${det.precision.toFixed(3)} ` +
            `recall=${det.recall.toFixed(3)} f1=${det.f1.toFixed(3)} ` +
            `(detected ${detected}/${totalGold}, flagged ${totalFlagged})`,
    );

    if (goldLabels.length > 0) {
        const cm = confusionMatrix(goldLabels, predLabels);
        const per = perLabelMetrics(cm);
        console.log(`Classifier macro-F1 (matched defects): ${macroF1(per).toFixed(3)}`);
        console.log(`Classifier Cohen's kappa: ${cohenKappa(goldLabels, predLabels).toFixed(3)}`);
        console.table(per);
    } else {
        console.log("No defects detected → classification metrics unavailable.");
    }
    console.log(
        `Goal pass rate: ${goalsTotal === 0 ? 0 : (goalsPassed / goalsTotal).toFixed(3)} ` +
            `(${goalsPassed}/${goalsTotal})`,
    );
    console.log("========================================");
}

if (import.meta.main) {
    await main();
}
