export interface StepRecord {
    stepIndex: number;
    status: string;
    description?: string;
    evidence?: string;
}

export interface GoalSteps {
    goal: string;
    steps: StepRecord[];
}

export interface StepStat {
    total: number;
    passed: number;
    passRate: number;
}

export interface StepChange {
    goal: string;
    stepIndex: number;
    description?: string;
    baseline: string;
    experiment: string;
    evidence?: string;
}

export interface StepDriftResult {
    baseline: StepStat;
    experiment: StepStat;
    regressions: StepChange[];
    improvements: StepChange[];
    paired: number;
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
