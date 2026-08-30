/**
 * stepDrift.ts — step-level (paired) drift analysis.
 *
 * Goal-level status is all-or-nothing: a goal chaining 4–5 documented operations
 * is PARTIAL_FAILURE whether one step broke or four did, so a version bump that
 * breaks one step inside an already-partial goal is INVISIBLE (observed: eslint
 * and marked showed zero goal-level drift while steps genuinely regressed).
 *
 * Steps are a sounder unit here because each step is an INDEPENDENT generated
 * program run in its own container (Executor: "independent programs that do not
 * share state") — no failure cascade inflates the count. And because the
 * experiment re-executes the baseline's programs VERBATIM (freeze), step i is
 * literally the same code on both versions, making this a PAIRED comparison.
 *
 * Pure and dependency-free — unit-tested in stepDrift.test.ts.
 */

/** One executed program within a goal. */
export interface StepRecord {
    stepIndex: number;
    status: string;
    description?: string;
    /** Error text + failure analysis, used as drift evidence downstream. */
    evidence?: string;
}

/** A goal and the programs generated for it. */
export interface GoalSteps {
    goal: string;
    steps: StepRecord[];
}

export interface StepStat {
    total: number;
    passed: number;
    /** passed / total, 0 when there are no steps. */
    passRate: number;
}

export interface StepChange {
    goal: string;
    stepIndex: number;
    description?: string;
    baseline: string;
    experiment: string;
    /** Evidence from the EXPERIMENT side (why it broke). */
    evidence?: string;
}

export interface StepDriftResult {
    baseline: StepStat;
    experiment: StepStat;
    /** SUCCESS on the old version, not SUCCESS on the new one — the drift signal. */
    regressions: StepChange[];
    /** Not SUCCESS → SUCCESS. With frozen code this can only be flakiness; it is
     *  reported so residual measurement noise can be quantified rather than hidden. */
    improvements: StepChange[];
    /** Steps compared on both sides. */
    paired: number;
    /** Steps that existed on only one side (excluded from regression counting). */
    unpaired: number;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();

function statOf(goals: GoalSteps[]): StepStat {
    let total = 0, passed = 0;
    for (const g of goals) {
        for (const s of g.steps) {
            total++;
            if (s.status === "SUCCESS") passed++;
        }
    }
    return { total, passed, passRate: total === 0 ? 0 : passed / total };
}

/**
 * Pair steps across phases and classify each transition.
 *
 * Goals are matched by normalised text (falling back to position, since a frozen
 * rerun preserves goal order), then steps are matched by `stepIndex` within the
 * goal — never by flattening, which would silently misalign every step after a
 * goal whose program count differs.
 */
export function analyzeStepDrift(
    baselineGoals: GoalSteps[],
    experimentGoals: GoalSteps[],
): StepDriftResult {
    const regressions: StepChange[] = [];
    const improvements: StepChange[] = [];
    let paired = 0, unpaired = 0;

    baselineGoals.forEach((b, i) => {
        const match = experimentGoals.find((e) => norm(e.goal) === norm(b.goal)) ??
            experimentGoals[i];
        if (!match) {
            unpaired += b.steps.length;
            return;
        }
        const byIndex = new Map(match.steps.map((s) => [s.stepIndex, s]));
        for (const bs of b.steps) {
            const es = byIndex.get(bs.stepIndex);
            if (!es) {
                unpaired++;
                continue;
            }
            paired++;
            const change: StepChange = {
                goal: b.goal,
                stepIndex: bs.stepIndex,
                description: bs.description,
                baseline: bs.status,
                experiment: es.status,
                evidence: es.evidence,
            };
            if (bs.status === "SUCCESS" && es.status !== "SUCCESS") regressions.push(change);
            else if (bs.status !== "SUCCESS" && es.status === "SUCCESS") improvements.push(change);
        }
    });

    return {
        baseline: statOf(baselineGoals),
        experiment: statOf(experimentGoals),
        regressions,
        improvements,
        paired,
        unpaired,
    };
}
