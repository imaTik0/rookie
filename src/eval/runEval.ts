/**
 * End-to-end evaluation runner.
 *
 * Drives a RUNNING Rookie instance over its HTTP API for each labelled fixture,
 * then scores against the ground truth in fixtures.ts:
 *   1. documentation-gap DETECTION (precision / recall / F1),
 *   2. gap CLASSIFICATION (per-label PRF, macro-F1, Cohen's kappa),
 *   3. fragment LOCALIZATION (verified-quote rate, correct-file accuracy),
 *   4. classifier CONFIDENCE (self-consistency agreement on true vs spurious flags),
 *   5. docs-PATCH coverage (how many detected defects yield an applyable hunk),
 *   6. goal pass rates (strict and step-level; PARTIAL_FAILURE-aware).
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
 * separately in metrics.test.ts (and src/feedback/feedback.test.ts).
 */
import { EvalFixture, FIXTURES } from "./fixtures.ts";
import {
    cohenKappa,
    confusionMatrix,
    detectionMetrics,
    GapLabel,
    LocalizationRecord,
    localizationMetrics,
    macroF1,
    mean,
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
        confidence?: number;
        votes?: number;
        fragmentVerification?: {
            verified: boolean;
            file?: string;
            lineStart?: number;
            lineEnd?: number;
            matchScore: number;
        };
    };
}
interface ReportLike {
    id?: string;
    _id?: string;
    status: string;
    steps: StepLike[];
    coverageReport?: { subtask: string; covered: boolean }[];
    frictionEvents?: { type: string }[];
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

async function getReport(reportId: string): Promise<(ReportLike & { id: string }) | null> {
    const res = await fetch(`${BASE}/reports/${reportId}`);
    if (!res.ok) return null;
    const json = await res.json();
    return { ...json, id: json.id ?? json._id ?? reportId };
}

/** Fetch the raw unified docs patch for a report ("" when none / unavailable). */
async function getDocsPatch(reportId: string): Promise<string> {
    try {
        const res = await fetch(`${BASE}/reports/${reportId}/docs-patch?format=diff`);
        if (!res.ok) return "";
        return await res.text();
    } catch {
        return "";
    }
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
    const localization: LocalizationRecord[] = [];
    const confidenceTrue: number[] = []; // confidence on flags matching an injected defect
    const confidenceSpurious: number[] = []; // confidence on flags matching nothing
    let detected = 0;
    let totalGold = 0;
    let totalFlagged = 0;
    let patchableDefects = 0;
    let goalsPassed = 0;
    let goalsPartial = 0;
    let goalsTotal = 0;
    let stepsPassed = 0;
    let stepsTotal = 0;
    let coverageReports = 0;
    let uncoveredSubtasks = 0;
    let frictionTotal = 0;

    for (const fixture of FIXTURES) {
        console.log(`\n=== Fixture: ${fixture.name} ===`);
        try {
            const fileIds = await uploadFiles(fixture);
            const projectId = await createProject(fixture.name, fileIds);
            const reportIds = await runMasterPlan(projectId, fixture.goals.length);
            const reports = (await Promise.all(reportIds.map(getReport))).filter(
                (r): r is ReportLike & { id: string } => !!r,
            );

            const allFailures = reports.flatMap((r) =>
                r.steps.filter((s) => s.status === "FAILED" && s.failureAnalysis)
                    .map((s) => ({ step: s, reportId: r.id }))
            );
            // Documentation-gap flags exclude ENVIRONMENT (tooling, not docs).
            const docFailures = allFailures.filter(
                (f) => f.step.failureAnalysis!.documentationGap !== "ENVIRONMENT",
            );
            totalFlagged += docFailures.length;

            goalsTotal += reports.length;
            goalsPassed += reports.filter((r) => r.status === "SUCCESS").length;
            goalsPartial += reports.filter((r) => r.status === "PARTIAL_FAILURE").length;
            for (const r of reports) {
                stepsTotal += r.steps.length;
                stepsPassed += r.steps.filter((s) => s.status === "SUCCESS").length;
                if (r.coverageReport?.length) {
                    coverageReports++;
                    uncoveredSubtasks += r.coverageReport.filter((c) => !c.covered).length;
                }
                frictionTotal += r.frictionEvents?.length ?? 0;
            }

            const matchedFlags = new Set<StepLike>();
            for (const defect of fixture.expectedDefects) {
                totalGold++;
                const kw = defect.matchKeywords.map((k) => k.toLowerCase());
                const match = docFailures.find((f) => {
                    const t = failureText(f.step);
                    return kw.some((k) => t.includes(k));
                });
                if (match) {
                    detected++;
                    matchedFlags.add(match.step);
                    const fa = match.step.failureAnalysis!;
                    goldLabels.push(defect.expectedGap);
                    predLabels.push(fa.documentationGap);
                    localization.push({
                        expectedFile: defect.file,
                        predictedFile: fa.fragmentVerification?.file,
                        verified: fa.fragmentVerification?.verified === true,
                    });
                    if (typeof fa.confidence === "number") confidenceTrue.push(fa.confidence);

                    // Patch coverage: does the report's docs patch touch the defect file?
                    const patch = await getDocsPatch(match.reportId);
                    const patched = patch.includes(`a/${defect.file}`);
                    if (patched) patchableDefects++;

                    console.log(
                        `  [DETECTED] ${defect.id}: expected=${defect.expectedGap} ` +
                            `predicted=${fa.documentationGap} ` +
                            `conf=${fa.confidence ?? "n/a"} ` +
                            `fragment=${
                                fa.fragmentVerification?.verified
                                    ? `verified@${fa.fragmentVerification.file}:${fa.fragmentVerification.lineStart}`
                                    : "unverified"
                            } patch=${patched ? "yes" : "no"}`,
                    );
                } else {
                    console.log(`  [MISSED]   ${defect.id} (expected ${defect.expectedGap})`);
                }
            }
            for (const f of docFailures) {
                if (!matchedFlags.has(f.step)) {
                    const conf = f.step.failureAnalysis?.confidence;
                    if (typeof conf === "number") confidenceSpurious.push(conf);
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

        const loc = localizationMetrics(localization);
        console.log(
            `Fragment localization: verified=${loc.verifiedRate.toFixed(3)} ` +
                `file-accuracy=${loc.fileAccuracy.toFixed(3)} ` +
                `(of verified: ${loc.fileAccuracyOfVerified.toFixed(3)}, n=${loc.support})`,
        );
        console.log(
            `Docs-patch coverage: ${patchableDefects}/${detected} detected defects yield an applyable hunk`,
        );
    } else {
        console.log("No defects detected → classification/localization metrics unavailable.");
    }

    console.log(
        `Classifier confidence: true-positive flags=${mean(confidenceTrue).toFixed(3)} ` +
            `(n=${confidenceTrue.length}), spurious flags=${mean(confidenceSpurious).toFixed(3)} ` +
            `(n=${confidenceSpurious.length})` +
            (confidenceTrue.length && confidenceSpurious.length
                ? ` — separation ${(mean(confidenceTrue) - mean(confidenceSpurious)).toFixed(3)}`
                : ""),
    );

    console.log(
        `Goal pass rate (strict): ${
            goalsTotal === 0 ? "0" : (goalsPassed / goalsTotal).toFixed(3)
        } (${goalsPassed}/${goalsTotal}, +${goalsPartial} partial)`,
    );
    console.log(
        `Step pass rate: ${stepsTotal === 0 ? "0" : (stepsPassed / stepsTotal).toFixed(3)} ` +
            `(${stepsPassed}/${stepsTotal})`,
    );
    console.log(
        `Coverage reports: ${coverageReports}/${goalsTotal} runs, ` +
            `${uncoveredSubtasks} uncovered subtask(s) flagged; ` +
            `friction events: ${frictionTotal}`,
    );
    console.log("========================================");
}

if (import.meta.main) {
    await main();
}
