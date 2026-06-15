/**
 * Unit tests for the evaluation metrics. Run with: `deno test src/eval/metrics.test.ts`
 * These need no infrastructure (no Mongo/Qdrant/Docker/LLM).
 */
import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
    accuracy,
    cohenKappa,
    confusionMatrix,
    detectionMetrics,
    GapLabel,
    localizationMetrics,
    macroF1,
    majorityVote,
    mean,
    perLabelMetrics,
} from "./metrics.ts";

Deno.test("detectionMetrics computes precision/recall/f1", () => {
    // 8 detected, 10 injected defects, 12 total flagged
    const m = detectionMetrics(8, 10, 12);
    assertAlmostEquals(m.recall, 0.8, 1e-9);
    assertAlmostEquals(m.precision, 8 / 12, 1e-9);
    assertAlmostEquals(m.f1, (2 * (8 / 12) * 0.8) / (8 / 12 + 0.8), 1e-9);
});

Deno.test("detectionMetrics handles empty denominators", () => {
    const m = detectionMetrics(0, 0, 0);
    assertEquals(m.precision, 0);
    assertEquals(m.recall, 0);
    assertEquals(m.f1, 0);
});

Deno.test("accuracy and confusionMatrix agree", () => {
    const gold: GapLabel[] = ["MISSING", "MISSING", "CONFIG", "INCORRECT"];
    const pred: GapLabel[] = ["MISSING", "CONFIG", "CONFIG", "INCORRECT"];
    assertEquals(accuracy(gold, pred), 0.75);

    const cm = confusionMatrix(gold, pred);
    const per = perLabelMetrics(cm);
    // MISSING: 1 tp, 0 fp, 1 fn -> recall .5, precision 1
    assertAlmostEquals(per["MISSING"].recall, 0.5, 1e-9);
    assertAlmostEquals(per["MISSING"].precision, 1, 1e-9);
    // CONFIG: 1 tp, 1 fp, 0 fn -> precision .5, recall 1
    assertAlmostEquals(per["CONFIG"].precision, 0.5, 1e-9);
    assertAlmostEquals(per["CONFIG"].recall, 1, 1e-9);
});

Deno.test("cohenKappa is 1 for perfect agreement and 0 for chance", () => {
    const a: GapLabel[] = ["MISSING", "CONFIG", "INCORRECT", "MISSING"];
    assertEquals(cohenKappa(a, a), 1);

    // Total disagreement but matched marginals can give <= 0
    const gold: GapLabel[] = ["MISSING", "CONFIG"];
    const pred: GapLabel[] = ["CONFIG", "MISSING"];
    const k = cohenKappa(gold, pred);
    assertEquals(k <= 0, true);
});

Deno.test("macroF1 ignores unsupported labels", () => {
    const gold: GapLabel[] = ["MISSING", "MISSING"];
    const pred: GapLabel[] = ["MISSING", "MISSING"];
    const per = perLabelMetrics(confusionMatrix(gold, pred));
    assertEquals(macroF1(per), 1);
});

Deno.test("majorityVote picks the plurality label", () => {
    assertEquals(majorityVote(["MISSING", "MISSING", "CONFIG"]), "MISSING");
    assertEquals(majorityVote([]), "UNKNOWN");
});

Deno.test("mean handles empty and non-empty lists", () => {
    assertEquals(mean([]), 0);
    assertAlmostEquals(mean([0.5, 1, 0]), 0.5, 1e-9);
});

Deno.test("localizationMetrics scores verification and file accuracy", () => {
    const stats = localizationMetrics([
        // verified & correct file
        { expectedFile: "a.md", predictedFile: "a.md", verified: true },
        // verified but wrong file
        { expectedFile: "a.md", predictedFile: "b.md", verified: true },
        // unverified
        { expectedFile: "c.md", predictedFile: undefined, verified: false },
        // unverified with a stale predicted file must not count as correct
        { expectedFile: "d.md", predictedFile: "d.md", verified: false },
    ]);
    assertAlmostEquals(stats.verifiedRate, 0.5, 1e-9);
    assertAlmostEquals(stats.fileAccuracy, 0.25, 1e-9);
    assertAlmostEquals(stats.fileAccuracyOfVerified, 0.5, 1e-9);
    assertEquals(stats.support, 4);
});

Deno.test("localizationMetrics handles empty input", () => {
    const stats = localizationMetrics([]);
    assertEquals(stats.support, 0);
    assertEquals(stats.verifiedRate, 0);
    assertEquals(stats.fileAccuracy, 0);
});
