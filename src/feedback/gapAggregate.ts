import type * as types from "../types/index.ts";
import { tokenOverlap } from "./fragmentVerify.ts";

export interface GapFinding {
    goal: string;
    reportId: string | null;
    stepIndex: number;
    analysis: types.report.FailureAnalysis;
}

export interface GapCluster {
    key: string;
    documentationGap: types.report.DocumentationGap;
    file?: string;
    lineStart?: number;
    lineEnd?: number;
    fragment: string;
    proposedFix: string;
    failedFunction: string;
    occurrences: number;
    affectedGoals: string[];
    meanConfidence?: number;
    verified: boolean;
    reportIds: string[];
}

const CLUSTER_SIMILARITY = 0.6;

function fragmentOf(a: types.report.FailureAnalysis): string {
    return a.fragmentVerification?.matchedText ?? a.pinpointedFragment ?? "";
}

function sameCluster(a: GapFinding, b: GapFinding): boolean {
    const fa = a.analysis;
    const fb = b.analysis;

    const va = fa.fragmentVerification;
    const vb = fb.fragmentVerification;
    if (va?.verified && vb?.verified && va.file === vb.file) {
        if (
            va.lineStart !== undefined && va.lineEnd !== undefined &&
            vb.lineStart !== undefined && vb.lineEnd !== undefined
        ) {
            const overlap = Math.min(va.lineEnd, vb.lineEnd) - Math.max(va.lineStart, vb.lineStart);
            if (overlap > 0) return true;
        }
    }

    if (
        fa.failedFunction && fb.failedFunction &&
        fa.failedFunction !== "unknown" &&
        fa.failedFunction === fb.failedFunction &&
        fa.documentationGap === fb.documentationGap
    ) return true;

    const ta = fragmentOf(fa);
    const tb = fragmentOf(fb);
    if (ta && tb && tokenOverlap(ta, tb) >= CLUSTER_SIMILARITY) return true;

    return false;
}

export function clusterGaps(findings: GapFinding[]): GapCluster[] {
    const clusters: { members: GapFinding[] }[] = [];

    for (const finding of findings) {
        const target = clusters.find((c) => c.members.some((m) => sameCluster(m, finding)));
        if (target) target.members.push(finding);
        else clusters.push({ members: [finding] });
    }

    return clusters.map(({ members }) => {
        const sorted = [...members].sort((a, b) => {
            const av = a.analysis.fragmentVerification?.verified ? 1 : 0;
            const bv = b.analysis.fragmentVerification?.verified ? 1 : 0;
            if (av !== bv) return bv - av;
            return (b.analysis.confidence ?? 0) - (a.analysis.confidence ?? 0);
        });
        const rep = sorted[0].analysis;
        const confidences = members
            .map((m) => m.analysis.confidence)
            .filter((c): c is number => typeof c === "number");

        return {
            key: `${rep.fragmentVerification?.file ?? "unknown"}::${rep.failedFunction}`,
            documentationGap: rep.documentationGap,
            file: rep.fragmentVerification?.file,
            lineStart: rep.fragmentVerification?.lineStart,
            lineEnd: rep.fragmentVerification?.lineEnd,
            fragment: fragmentOf(rep),
            proposedFix: rep.proposedFragment || rep.suggestedDocsFix || "",
            failedFunction: rep.failedFunction,
            occurrences: members.length,
            affectedGoals: [...new Set(members.map((m) => m.goal))],
            meanConfidence: confidences.length
                ? Math.round((confidences.reduce((s, c) => s + c, 0) / confidences.length) * 1000) /
                    1000
                : undefined,
            verified: members.some((m) => m.analysis.fragmentVerification?.verified === true),
            reportIds: [...new Set(members.map((m) => m.reportId).filter((r): r is string => !!r))],
        };
    }).sort((a, b) => b.occurrences - a.occurrences);
}

export function collectFindings(
    executionReports: {
        goal: string;
        reportId: string | null;
        steps: { stepIndex: number; failureAnalysis?: types.report.FailureAnalysis }[];
    }[],
): GapFinding[] {
    const findings: GapFinding[] = [];
    for (const report of executionReports) {
        for (const step of report.steps ?? []) {
            const fa = step.failureAnalysis;
            if (!fa) continue;
            if (fa.documentationGap === "ENVIRONMENT") continue;
            findings.push({
                goal: report.goal,
                reportId: report.reportId,
                stepIndex: step.stepIndex,
                analysis: fa,
            });
        }
    }
    return findings;
}

export function taxonomyOf(
    findings: GapFinding[],
): Record<string, number> {
    const taxonomy: Record<string, number> = {};
    for (const f of findings) {
        taxonomy[f.analysis.documentationGap] = (taxonomy[f.analysis.documentationGap] ?? 0) + 1;
    }
    return taxonomy;
}

export function topFailingFunctionsOf(
    findings: GapFinding[],
    max = 10,
): { functionName: string; count: number; goals: string[] }[] {
    const byFn = new Map<string, { count: number; goals: Set<string> }>();
    for (const f of findings) {
        const fn = f.analysis.failedFunction;
        if (!fn || fn === "unknown" || fn.startsWith("n/a")) continue;
        const entry = byFn.get(fn) ?? { count: 0, goals: new Set<string>() };
        entry.count++;
        entry.goals.add(f.goal);
        byFn.set(fn, entry);
    }
    return [...byFn.entries()]
        .map(([functionName, { count, goals }]) => ({ functionName, count, goals: [...goals] }))
        .sort((a, b) => b.count - a.count)
        .slice(0, max);
}
