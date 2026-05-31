/**
 * Pure, dependency-free metrics for evaluating Rookie's documentation-gap
 * detection and classification against a labelled fixture set.
 *
 * All functions here are deterministic and unit-testable without any infra
 * (see metrics.test.ts) — the heavy, infra-dependent orchestration lives in
 * runEval.ts.
 */

export type GapLabel =
    | "MISSING"
    | "AMBIGUOUS"
    | "INCORRECT"
    | "CONFIG"
    | "ENVIRONMENT"
    | "UNKNOWN";

export const GAP_LABELS: GapLabel[] = [
    "MISSING",
    "AMBIGUOUS",
    "INCORRECT",
    "CONFIG",
    "ENVIRONMENT",
    "UNKNOWN",
];

export interface PRF {
    precision: number;
    recall: number;
    f1: number;
    support: number;
}

function f1Of(precision: number, recall: number): number {
    return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

/**
 * Binary detection metrics: did we flag a defect where one exists?
 * @param detected   number of true defects the system flagged (true positives)
 * @param totalGold  number of injected defects (TP + FN)
 * @param totalFlagged number of failures the system reported (TP + FP)
 */
export function detectionMetrics(
    detected: number,
    totalGold: number,
    totalFlagged: number,
): PRF {
    const precision = totalFlagged === 0 ? 0 : detected / totalFlagged;
    const recall = totalGold === 0 ? 0 : detected / totalGold;
    return { precision, recall, f1: f1Of(precision, recall), support: totalGold };
}

export interface ConfusionMatrix {
    labels: GapLabel[];
    /** matrix[gold][pred] counts. */
    matrix: number[][];
}

export function confusionMatrix(
    gold: GapLabel[],
    pred: GapLabel[],
    labels: GapLabel[] = GAP_LABELS,
): ConfusionMatrix {
    if (gold.length !== pred.length) {
        throw new Error("gold and pred must have equal length");
    }
    const index = new Map(labels.map((l, i) => [l, i]));
    const matrix = labels.map(() => labels.map(() => 0));
    for (let i = 0; i < gold.length; i++) {
        const g = index.get(gold[i]);
        const p = index.get(pred[i]);
        if (g === undefined || p === undefined) continue;
        matrix[g][p]++;
    }
    return { labels, matrix };
}

/** Per-label precision/recall/F1 derived from a confusion matrix. */
export function perLabelMetrics(cm: ConfusionMatrix): Record<string, PRF> {
    const { labels, matrix } = cm;
    const out: Record<string, PRF> = {};
    for (let i = 0; i < labels.length; i++) {
        const tp = matrix[i][i];
        let fp = 0;
        let fn = 0;
        for (let j = 0; j < labels.length; j++) {
            if (j !== i) {
                fp += matrix[j][i];
                fn += matrix[i][j];
            }
        }
        const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
        const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
        let support = 0;
        for (let j = 0; j < labels.length; j++) support += matrix[i][j];
        out[labels[i]] = { precision, recall, f1: f1Of(precision, recall), support };
    }
    return out;
}

export function macroF1(perLabel: Record<string, PRF>): number {
    const vals = Object.values(perLabel).filter((m) => m.support > 0);
    if (vals.length === 0) return 0;
    return vals.reduce((s, m) => s + m.f1, 0) / vals.length;
}

export function accuracy(gold: GapLabel[], pred: GapLabel[]): number {
    if (gold.length === 0) return 0;
    let correct = 0;
    for (let i = 0; i < gold.length; i++) if (gold[i] === pred[i]) correct++;
    return correct / gold.length;
}

/**
 * Cohen's kappa for categorical agreement between predicted and gold labels.
 * κ = (po - pe) / (1 - pe). Returns 1 for perfect agreement, 0 for chance.
 */
export function cohenKappa(
    gold: GapLabel[],
    pred: GapLabel[],
    labels: GapLabel[] = GAP_LABELS,
): number {
    const n = gold.length;
    if (n === 0) return 0;
    const po = accuracy(gold, pred);

    const goldCount = new Map<string, number>();
    const predCount = new Map<string, number>();
    for (const l of labels) {
        goldCount.set(l, 0);
        predCount.set(l, 0);
    }
    for (let i = 0; i < n; i++) {
        goldCount.set(gold[i], (goldCount.get(gold[i]) || 0) + 1);
        predCount.set(pred[i], (predCount.get(pred[i]) || 0) + 1);
    }
    let pe = 0;
    for (const l of labels) {
        pe += ((goldCount.get(l) || 0) / n) * ((predCount.get(l) || 0) / n);
    }
    return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

/** Plurality/majority vote over a list of labels. Ties resolved by first-seen order. */
export function majorityVote(labels: GapLabel[]): GapLabel {
    if (labels.length === 0) return "UNKNOWN";
    const counts = new Map<GapLabel, number>();
    for (const l of labels) counts.set(l, (counts.get(l) || 0) + 1);
    let best = labels[0];
    let bestCount = 0;
    for (const l of labels) {
        const c = counts.get(l)!;
        if (c > bestCount) {
            bestCount = c;
            best = l;
        }
    }
    return best;
}
