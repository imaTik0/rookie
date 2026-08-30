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

export function mean(xs: number[]): number {
    if (xs.length === 0) return 0;
    return xs.reduce((s, x) => s + x, 0) / xs.length;
}

export interface LocalizationRecord {
    expectedFile: string;
    predictedFile?: string;
    verified: boolean;
}

export interface LocalizationStats {
    verifiedRate: number;
    fileAccuracy: number;
    fileAccuracyOfVerified: number;
    support: number;
}

export function localizationMetrics(records: LocalizationRecord[]): LocalizationStats {
    const support = records.length;
    if (support === 0) {
        return { verifiedRate: 0, fileAccuracy: 0, fileAccuracyOfVerified: 0, support: 0 };
    }
    const verified = records.filter((r) => r.verified);
    const correct = records.filter(
        (r) => r.verified && r.predictedFile !== undefined && r.predictedFile === r.expectedFile,
    );
    return {
        verifiedRate: verified.length / support,
        fileAccuracy: correct.length / support,
        fileAccuracyOfVerified: verified.length === 0 ? 0 : correct.length / verified.length,
        support,
    };
}

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
