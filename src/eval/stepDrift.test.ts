/**
 * Unit tests for step-level (paired) drift analysis. Pure — no infrastructure.
 * Run with: deno test src/eval/stepDrift.test.ts
 */
import { assertEquals } from "@std/assert";
import { analyzeStepDrift, type GoalSteps } from "./stepDrift.ts";

const g = (goal: string, statuses: string[]): GoalSteps => ({
    goal,
    steps: statuses.map((status, i) => ({ stepIndex: i + 1, status })),
});

Deno.test("computes step pass rates for both phases", () => {
    const r = analyzeStepDrift(
        [g("A", ["SUCCESS", "SUCCESS", "FAILED"])],
        [g("A", ["SUCCESS", "FAILED", "FAILED"])],
    );
    assertEquals(r.baseline, { total: 3, passed: 2, passRate: 2 / 3 });
    assertEquals(r.experiment, { total: 3, passed: 1, passRate: 1 / 3 });
});

Deno.test("detects drift that goal-level status HIDES (partial → partial)", () => {
    // The eslint/marked case: the goal is PARTIAL_FAILURE in both phases, so goal
    // status cannot move — yet a step genuinely regressed.
    const r = analyzeStepDrift(
        [g("A", ["SUCCESS", "SUCCESS", "FAILED"])], // goal = PARTIAL
        [g("A", ["SUCCESS", "FAILED", "FAILED"])], // goal = PARTIAL (unchanged)
    );
    assertEquals(r.regressions.length, 1);
    assertEquals(r.regressions[0].stepIndex, 2);
    assertEquals(r.improvements.length, 0);
});

Deno.test("SUCCESS → PARTIAL_FAILURE counts as a step regression", () => {
    const r = analyzeStepDrift([g("A", ["SUCCESS"])], [g("A", ["PARTIAL_FAILURE"])]);
    assertEquals(r.regressions.length, 1);
});

Deno.test("improvements are reported separately (frozen code ⇒ flakiness)", () => {
    const r = analyzeStepDrift([g("A", ["FAILED"])], [g("A", ["SUCCESS"])]);
    assertEquals(r.improvements.length, 1);
    assertEquals(r.regressions.length, 0);
});

Deno.test("goals are matched by text, not position", () => {
    const r = analyzeStepDrift(
        [g("alpha", ["SUCCESS"]), g("beta", ["SUCCESS"])],
        [g("beta", ["SUCCESS"]), g("alpha", ["FAILED"])], // reordered
    );
    assertEquals(r.regressions.length, 1);
    assertEquals(r.regressions[0].goal, "alpha");
});

Deno.test("steps present on only one side are unpaired, not regressions", () => {
    const r = analyzeStepDrift(
        [g("A", ["SUCCESS", "SUCCESS", "SUCCESS"])],
        [g("A", ["SUCCESS"])],
    );
    assertEquals(r.paired, 1);
    assertEquals(r.unpaired, 2);
    assertEquals(r.regressions.length, 0);
});

Deno.test("a goal missing from the experiment contributes only unpaired steps", () => {
    const r = analyzeStepDrift([g("A", ["SUCCESS"]), g("gone", ["SUCCESS", "SUCCESS"])], [
        g("A", ["SUCCESS"]),
    ]);
    // "gone" falls back to positional match against index 1 — which does not
    // exist — so its steps are unpaired rather than silently misaligned.
    assertEquals(r.unpaired, 2);
    assertEquals(r.regressions.length, 0);
});

Deno.test("carries experiment-side evidence on a regression", () => {
    const r = analyzeStepDrift(
        [{ goal: "A", steps: [{ stepIndex: 1, status: "SUCCESS" }] }],
        [{
            goal: "A",
            steps: [{ stepIndex: 1, status: "FAILED", evidence: "isStream is not a function" }],
        }],
    );
    assertEquals(r.regressions[0].evidence, "isStream is not a function");
});

Deno.test("empty input is safe", () => {
    const r = analyzeStepDrift([], []);
    assertEquals(r.baseline.passRate, 0);
    assertEquals(r.regressions.length, 0);
    assertEquals(r.paired, 0);
});
