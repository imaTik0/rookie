#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * recompute-step-drift.ts — backfill step-level drift + corrected recall into
 * experiment reports that were produced before those metrics existed.
 *
 * Everything needed is already on disk: `experiment-<cfg>-<ts>-full-reports.json`
 * holds both master plans and every per-goal report (including per-step status
 * and failure analysis). So the new metrics are recomputed offline — no Rookie
 * instance, no Docker, and no re-running of any experiment.
 *
 * Writes `stepDrift` and a corrected `changelog.detection` back into the matching
 * `experiment-<cfg>-<ts>.json` (use --dry-run to preview).
 *
 * Usage:
 *   deno run --allow-read --allow-write scripts/recompute-step-drift.ts --dry-run
 *   deno run --allow-read --allow-write scripts/recompute-step-drift.ts
 *   deno run --allow-read --allow-write scripts/recompute-step-drift.ts --dir DIR
 */
import { analyzeStepDrift, type GoalSteps } from "../src/eval/stepDrift.ts";
import {
    CHANGELOG_SEEDS,
    driftEvidenceSignals,
    scoreBreakingChanges,
} from "../src/eval/changelogSeed.ts";

const DRY_RUN = Deno.args.includes("--dry-run");
/** Directory holding the experiment reports (default: the archived results tree). */
const DATA_DIR = (() => {
    const i = Deno.args.indexOf("--dir");
    return i !== -1 ? Deno.args[i + 1] ?? "." : "../docs_and_raports/wyniki-eksperymentow";
})();

function toGoalSteps(
    plan: Record<string, unknown> | undefined,
    reports: Record<string, unknown>,
): GoalSteps[] {
    const summary = plan?.structuredSummary as Record<string, unknown> | undefined;
    const breakdown = (summary?.goalsBreakdown ?? []) as Record<string, unknown>[];
    return breakdown.map((g) => {
        const rep = reports[String(g.reportId)] as Record<string, unknown> | undefined;
        const steps = (rep?.steps ?? []) as Record<string, unknown>[];
        return {
            goal: String(g.goal ?? ""),
            steps: steps.map((s) => {
                const fa = s.failureAnalysis as Record<string, unknown> | undefined;
                return {
                    stepIndex: Number(s.stepIndex ?? 0),
                    status: String(s.status ?? "FAILED"),
                    description: String(s.stepDescription ?? ""),
                    evidence: [s.error, fa?.failedFunction, fa?.reasoning, fa?.suggestedDocsFix]
                        .filter(Boolean).join(" ").slice(0, 1500),
                };
            }),
        };
    });
}

const gapsOf = (plan: Record<string, unknown> | undefined) =>
    ((plan?.structuredSummary as Record<string, unknown> | undefined)
        ?.documentationGapDetails ?? []) as Record<string, unknown>[];

// Newest bundle per config key.
const bundles = new Map<string, string>();
for (const e of Deno.readDirSync(DATA_DIR)) {
    const m = e.isFile && e.name.match(/^experiment-([a-z0-9]+)-(\d+)-full-reports\.json$/);
    if (!m) continue;
    const prev = bundles.get(m[1]);
    if (!prev || e.name > prev) bundles.set(m[1], `${DATA_DIR}/${e.name}`);
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
console.log(
    `${"target".padEnd(11)} ${"steps base→exp".padEnd(22)} ${"regr".padEnd(6)} ${
        "detected".padEnd(9)
    } ${"confirmed".padEnd(10)} note`,
);

let updated = 0;
for (const [key, bundleFile] of [...bundles].sort()) {
    const bundle = JSON.parse(Deno.readTextFileSync(bundleFile)) as Record<string, unknown>;
    const reports = (bundle.goalReports ?? {}) as Record<string, unknown>;
    const basePlan = bundle.baseline as Record<string, unknown> | undefined;
    const expPlan = bundle.experiment as Record<string, unknown> | undefined;
    if (!basePlan || !expPlan) {
        console.log(`${key.padEnd(11)} ${"—".padEnd(22)} ${"—".padEnd(6)} ${"—".padEnd(8)} bundle
            lacks both phases`.replace(/\s+/g, " "));
        continue;
    }

    const sd = analyzeStepDrift(toGoalSteps(basePlan, reports), toGoalSteps(expPlan, reports));

    const seed = CHANGELOG_SEEDS[key];
    let detection: ReturnType<typeof scoreBreakingChanges> | null = null;
    if (seed) {
        detection = scoreBreakingChanges(
            seed,
            driftEvidenceSignals({
                stepRegressions: sd.regressions,
                experimentGaps: gapsOf(expPlan),
                baselineGaps: gapsOf(basePlan),
            }),
        );
    }

    // Locate the matching top-level report (same timestamp).
    const stamp = bundleFile.match(/-(\d+)-full-reports\.json$/)![1];
    const reportFile = `${DATA_DIR}/experiment-${key}-${stamp}.json`;
    let note = "";
    try {
        const report = JSON.parse(Deno.readTextFileSync(reportFile)) as Record<string, unknown>;
        const oldRecall = (report.changelog as Record<string, unknown> | null)?.detection as
            | { detected: number; total: number }
            | undefined;
        report.stepDrift = sd;
        if (detection && report.changelog) {
            (report.changelog as Record<string, unknown>).detection = detection;
            if (oldRecall && oldRecall.detected !== detection.detected) {
                note =
                    `recall ${oldRecall.detected}/${oldRecall.total} → ${detection.detected}/${detection.total}`;
            }
        }
        if (!DRY_RUN) Deno.writeTextFileSync(reportFile, JSON.stringify(report, null, 2));
        updated++;
    } catch {
        note = "no matching report file";
    }

    console.log(
        key.padEnd(11),
        `${sd.baseline.passed}/${sd.baseline.total} (${
            pct(sd.baseline.passRate)
        }) → ${sd.experiment.passed}/${sd.experiment.total} (${pct(sd.experiment.passRate)})`
            .padEnd(22),
        `-${sd.regressions.length}/+${sd.improvements.length}`.padEnd(6),
        (detection ? `${detection.detected}/${detection.total}` : "—").padEnd(9),
        (detection ? `${detection.confirmed}/${detection.total}` : "—").padEnd(10),
        note,
    );
}
console.log(
    `\n${DRY_RUN ? "Dry run — nothing written." : `Updated ${updated} report(s).`}`,
);
