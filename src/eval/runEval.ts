import { EvalFixture, FIXTURES } from "./fixtures.ts";
import {
    cohenKappa,
    confusionMatrix,
    detectionMetrics,
    GapLabel,
    localizationMetrics,
    LocalizationRecord,
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

async function streamMasterPlan(
    endpoint: string,
    body: Record<string, unknown>,
): Promise<{ reportIds: string[]; masterPlanId: string | null }> {
    const res = await fetch(`${BASE}${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
        throw new Error(`${endpoint} failed: ${res.status} ${await res.text()}`);
    }
    const reportIds = new Set<string>();
    let masterPlanId: string | null = null;
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
                if (evt.type === "COMPLETE" && evt.result?._id) {
                    masterPlanId = evt.result._id;
                }
            } catch { /* progress log line, ignore */ }
        }
    }
    return { reportIds: [...reportIds], masterPlanId };
}

async function runMasterPlan(
    projectId: string,
    maxGoals: number,
): Promise<{ reportIds: string[]; masterPlanId: string | null }> {
    return streamMasterPlan("/planner/run", { projectId, maxGoals, initialContext: "{}" });
}

async function rerunMasterPlan(
    masterPlanId: string,
    projectId: string,
): Promise<{ reportIds: string[]; masterPlanId: string | null }> {
    return streamMasterPlan("/planner/rerun", { masterPlanId, projectId, initialContext: "{}" });
}

async function getReport(reportId: string): Promise<(ReportLike & { id: string }) | null> {
    const res = await fetch(`${BASE}/reports/${reportId}`);
    if (!res.ok) return null;
    const json = await res.json();
    return { ...json, id: json.id ?? json._id ?? reportId };
}

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

function scoreReports(
    reports: (ReportLike & { id: string })[],
    fixture: EvalFixture,
    acc: {
        goldLabels: GapLabel[];
        predLabels: GapLabel[];
        localization: LocalizationRecord[];
        confidenceTrue: number[];
        confidenceSpurious: number[];
        detected: { value: number };
        totalGold: { value: number };
        totalFlagged: { value: number };
        goalsPassed: { value: number };
        goalsPartial: { value: number };
        goalsTotal: { value: number };
        stepsPassed: { value: number };
        stepsTotal: { value: number };
        coverageReports: { value: number };
        uncoveredSubtasks: { value: number };
        frictionTotal: { value: number };
    },
): Promise<{ patchableDefects: number }> {
    const allFailures = reports.flatMap((r) =>
        r.steps.filter((s) => s.status === "FAILED" && s.failureAnalysis)
            .map((s) => ({ step: s, reportId: r.id }))
    );
    const docFailures = allFailures.filter(
        (f) => f.step.failureAnalysis!.documentationGap !== "ENVIRONMENT",
    );
    acc.totalFlagged.value += docFailures.length;

    acc.goalsTotal.value += reports.length;
    acc.goalsPassed.value += reports.filter((r) => r.status === "SUCCESS").length;
    acc.goalsPartial.value += reports.filter((r) => r.status === "PARTIAL_FAILURE").length;
    for (const r of reports) {
        acc.stepsTotal.value += r.steps.length;
        acc.stepsPassed.value += r.steps.filter((s) => s.status === "SUCCESS").length;
        if (r.coverageReport?.length) {
            acc.coverageReports.value++;
            acc.uncoveredSubtasks.value += r.coverageReport.filter((c) => !c.covered).length;
        }
        acc.frictionTotal.value += r.frictionEvents?.length ?? 0;
    }

    const matchedFlags = new Set<StepLike>();
    const patchChecks: Promise<{ patched: boolean; defectId: string }>[] = [];

    for (const defect of fixture.expectedDefects) {
        acc.totalGold.value++;
        const kw = defect.matchKeywords.map((k) => k.toLowerCase());
        const match = docFailures.find((f) => {
            const t = failureText(f.step);
            return kw.some((k) => t.includes(k));
        });
        if (match) {
            acc.detected.value++;
            matchedFlags.add(match.step);
            const fa = match.step.failureAnalysis!;
            acc.goldLabels.push(defect.expectedGap);
            acc.predLabels.push(fa.documentationGap);
            acc.localization.push({
                expectedFile: defect.file,
                predictedFile: fa.fragmentVerification?.file,
                verified: fa.fragmentVerification?.verified === true,
            });
            if (typeof fa.confidence === "number") acc.confidenceTrue.push(fa.confidence);
            patchChecks.push(
                getDocsPatch(match.reportId).then((patch) => ({
                    patched: patch.includes(`a/${defect.file}`),
                    defectId: defect.id,
                })),
            );
        }
    }
    for (const f of docFailures) {
        if (!matchedFlags.has(f.step)) {
            const conf = f.step.failureAnalysis?.confidence;
            if (typeof conf === "number") acc.confidenceSpurious.push(conf);
        }
    }

    return Promise.all(patchChecks).then((checks) => ({
        patchableDefects: checks.filter((c) => c.patched).length,
    }));
}

async function main() {
    const before = {
        goldLabels: [] as GapLabel[],
        predLabels: [] as GapLabel[],
        localization: [] as LocalizationRecord[],
        confidenceTrue: [] as number[],
        confidenceSpurious: [] as number[],
        detected: { value: 0 },
        totalGold: { value: 0 },
        totalFlagged: { value: 0 },
        goalsPassed: { value: 0 },
        goalsPartial: { value: 0 },
        goalsTotal: { value: 0 },
        stepsPassed: { value: 0 },
        stepsTotal: { value: 0 },
        coverageReports: { value: 0 },
        uncoveredSubtasks: { value: 0 },
        frictionTotal: { value: 0 },
    };
    let patchableDefectsBefore = 0;

    const after = structuredClone(before);
    let patchableDefectsAfter = 0;
    let fixturesWithRerun = 0;

    for (const fixture of FIXTURES) {
        console.log(`\n=== Fixture: ${fixture.name} ===`);
        try {
            const fileIds = await uploadFiles(fixture);
            const projectId = await createProject(fixture.name, fileIds);
            const { reportIds, masterPlanId } = await runMasterPlan(
                projectId,
                fixture.goals.length,
            );
            const reports = (await Promise.all(reportIds.map(getReport))).filter(
                (r): r is ReportLike & { id: string } => !!r,
            );

            console.log(
                `  [BEFORE] ${reports.length} goal report(s), masterPlanId=${
                    masterPlanId ?? "n/a"
                }`,
            );
            const beforeScores = await scoreReports(reports, fixture, before);
            patchableDefectsBefore += beforeScores.patchableDefects;

            const allFailures = reports.flatMap((r) =>
                r.steps.filter((s) => s.status === "FAILED" && s.failureAnalysis)
                    .map((s) => ({ step: s, reportId: r.id }))
            );
            const docFailures = allFailures.filter(
                (f) => f.step.failureAnalysis!.documentationGap !== "ENVIRONMENT",
            );
            for (const defect of fixture.expectedDefects) {
                const kw = defect.matchKeywords.map((k) => k.toLowerCase());
                const match = docFailures.find((f) =>
                    kw.some((k) => failureText(f.step).includes(k))
                );
                if (match) {
                    const fa = match.step.failureAnalysis!;
                    console.log(
                        `  [BEFORE DETECTED] ${defect.id}: predicted=${fa.documentationGap} ` +
                            `conf=${fa.confidence ?? "n/a"} ` +
                            `fragment=${
                                fa.fragmentVerification?.verified
                                    ? `verified@${fa.fragmentVerification.file}:${fa.fragmentVerification.lineStart}`
                                    : "unverified"
                            }`,
                    );
                } else {
                    console.log(
                        `  [BEFORE MISSED]   ${defect.id} (expected ${defect.expectedGap})`,
                    );
                }
            }

            if (fixture.fixedFiles && fixture.fixedFiles.length > 0 && masterPlanId) {
                fixturesWithRerun++;
                console.log(`  [AFTER]  Re-running goals on fixed docs...`);
                try {
                    const fixedFileIds = await uploadFiles({
                        ...fixture,
                        files: fixture.fixedFiles,
                    });
                    const fixedProjectId = await createProject(
                        `${fixture.name}-fixed`,
                        fixedFileIds,
                    );
                    const { reportIds: rerunReportIds } = await rerunMasterPlan(
                        masterPlanId,
                        fixedProjectId,
                    );
                    const rerunReports = (await Promise.all(rerunReportIds.map(getReport))).filter(
                        (r): r is ReportLike & { id: string } => !!r,
                    );

                    const afterScores = await scoreReports(rerunReports, fixture, after);
                    patchableDefectsAfter += afterScores.patchableDefects;

                    const rerunAllFailures = rerunReports.flatMap((r) =>
                        r.steps.filter((s) => s.status === "FAILED" && s.failureAnalysis)
                            .map((s) => ({ step: s, reportId: r.id }))
                    );
                    const rerunDocFailures = rerunAllFailures.filter(
                        (f) => f.step.failureAnalysis!.documentationGap !== "ENVIRONMENT",
                    );
                    for (const defect of fixture.expectedDefects) {
                        const kw = defect.matchKeywords.map((k) => k.toLowerCase());
                        const match = rerunDocFailures.find(
                            (f) => kw.some((k) => failureText(f.step).includes(k)),
                        );
                        if (match) {
                            const fa = match.step.failureAnalysis!;
                            console.log(
                                `  [AFTER  DETECTED] ${defect.id}: predicted=${fa.documentationGap} ` +
                                    `conf=${
                                        fa.confidence ?? "n/a"
                                    } (persisted gap — fix may be incomplete)`,
                            );
                        } else {
                            console.log(`  [AFTER  RESOLVED] ${defect.id} ✓`);
                        }
                    }
                } catch (err) {
                    console.error(`  After-fix rerun failed: ${(err as Error).message}`);
                }
            }
        } catch (err) {
            console.error(`  Fixture failed to run: ${(err as Error).message}`);
        }
    }

    function printMetrics(
        label: string,
        acc: typeof before,
        patchable: number,
    ) {
        console.log(`\n========== ${label} ==========`);
        const det = detectionMetrics(
            acc.detected.value,
            acc.totalGold.value,
            acc.totalFlagged.value,
        );
        console.log(
            `Gap detection: precision=${det.precision.toFixed(3)} ` +
                `recall=${det.recall.toFixed(3)} f1=${det.f1.toFixed(3)} ` +
                `(detected ${acc.detected.value}/${acc.totalGold.value}, flagged ${acc.totalFlagged.value})`,
        );

        if (acc.goldLabels.length > 0) {
            const cm = confusionMatrix(acc.goldLabels, acc.predLabels);
            const per = perLabelMetrics(cm);
            console.log(`Classifier macro-F1 (matched defects): ${macroF1(per).toFixed(3)}`);
            console.log(
                `Classifier Cohen's kappa: ${
                    cohenKappa(acc.goldLabels, acc.predLabels).toFixed(3)
                }`,
            );
            console.table(per);

            const loc = localizationMetrics(acc.localization);
            console.log(
                `Fragment localization: verified=${loc.verifiedRate.toFixed(3)} ` +
                    `file-accuracy=${loc.fileAccuracy.toFixed(3)} ` +
                    `(of verified: ${loc.fileAccuracyOfVerified.toFixed(3)}, n=${loc.support})`,
            );
            console.log(
                `Docs-patch coverage: ${patchable}/${acc.detected.value} detected defects yield an applyable hunk`,
            );
        } else {
            console.log("No defects detected → classification/localization metrics unavailable.");
        }

        console.log(
            `Classifier confidence: true-positive flags=${mean(acc.confidenceTrue).toFixed(3)} ` +
                `(n=${acc.confidenceTrue.length}), ` +
                `spurious flags=${mean(acc.confidenceSpurious).toFixed(3)} ` +
                `(n=${acc.confidenceSpurious.length})` +
                (acc.confidenceTrue.length && acc.confidenceSpurious.length
                    ? ` — separation ${
                        (mean(acc.confidenceTrue) - mean(acc.confidenceSpurious)).toFixed(3)
                    }`
                    : ""),
        );
        console.log(
            `Goal pass rate (strict): ${
                acc.goalsTotal.value === 0
                    ? "0"
                    : (acc.goalsPassed.value / acc.goalsTotal.value).toFixed(3)
            } (${acc.goalsPassed.value}/${acc.goalsTotal.value}, +${acc.goalsPartial.value} partial)`,
        );
        console.log(
            `Step pass rate: ${
                acc.stepsTotal.value === 0
                    ? "0"
                    : (acc.stepsPassed.value / acc.stepsTotal.value).toFixed(3)
            } (${acc.stepsPassed.value}/${acc.stepsTotal.value})`,
        );
        console.log(
            `Coverage reports: ${acc.coverageReports.value}/${acc.goalsTotal.value} runs, ` +
                `${acc.uncoveredSubtasks.value} uncovered subtask(s); friction: ${acc.frictionTotal.value}`,
        );
        console.log("=".repeat(42));
    }

    printMetrics("EVALUATION SUMMARY — BEFORE (broken docs)", before, patchableDefectsBefore);

    if (fixturesWithRerun > 0) {
        printMetrics(
            "EVALUATION SUMMARY — AFTER (fixed docs, same goals)",
            after,
            patchableDefectsAfter,
        );

        const detBefore = detectionMetrics(
            before.detected.value,
            before.totalGold.value,
            before.totalFlagged.value,
        );
        const detAfter = detectionMetrics(
            after.detected.value,
            after.totalGold.value,
            after.totalFlagged.value,
        );
        const passRateBefore = before.goalsTotal.value === 0
            ? 0
            : before.goalsPassed.value / before.goalsTotal.value;
        const passRateAfter = after.goalsTotal.value === 0
            ? 0
            : after.goalsPassed.value / after.goalsTotal.value;

        console.log("\n========== BEFORE → AFTER DELTA ==========");
        console.log(
            `Gap detection recall: ${detBefore.recall.toFixed(3)} → ${
                detAfter.recall.toFixed(3)
            } ` +
                `(${(detAfter.recall - detBefore.recall >= 0 ? "+" : "")}${
                    (detAfter.recall - detBefore.recall).toFixed(3)
                })`,
        );
        console.log(
            `Goal pass rate: ${passRateBefore.toFixed(3)} → ${passRateAfter.toFixed(3)} ` +
                `(${(passRateAfter - passRateBefore >= 0 ? "+" : "")}${
                    (passRateAfter - passRateBefore).toFixed(3)
                })`,
        );
        console.log(
            `Defects resolved by fix: ${
                before.detected.value - after.detected.value
            }/${before.detected.value}`,
        );
        console.log("===========================================");
    }
}

if (import.meta.main) {
    await main();
}
