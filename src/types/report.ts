import * as types from "./index.ts";

export type ReportId = string & { __reportId: never };
export type StepStatus = "SUCCESS" | "FAILED";
export type ReportStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "PARTIAL_FAILURE";
export type DetailedResults = {
    finalOutput?: string;
    executionPlan?: any;
    initialContext?: string;
    steps?: any[];
    durationMs?: number;
    [key: string]: any;
};

export type DocumentationGap =
    | "MISSING"
    | "AMBIGUOUS"
    | "INCORRECT"
    | "CONFIG"
    | "ENVIRONMENT"
    | "UNKNOWN";

/** Result of grounding the LLM-quoted fragment in the real documentation corpus. */
export interface FragmentVerification {
    verified: boolean;
    file?: string;
    lineStart?: number;
    lineEnd?: number;
    matchScore: number;
    matchedText?: string;
}

export interface FailureAnalysis {
    errorMessage: string;
    failedFunction: string;
    documentationGap: DocumentationGap;
    reasoning: string;
    suggestedDocsFix: string;
    pinpointedFragment?: string;
    proposedFragment?: string;
    /** Self-consistency agreement: winning-category votes / total votes (0..1). */
    confidence?: number;
    /** Number of classifier votes cast. */
    votes?: number;
    /** Where (and whether) the pinpointed fragment was found in the actual docs. */
    fragmentVerification?: FragmentVerification;
}

/** Research-phase coverage: was each decomposed sub-task covered by the docs? */
export interface CoverageItem {
    subtask: string;
    covered: boolean;
    /** Search queries the agent needed to cover this sub-task. */
    queriesUsed?: string[];
    /** What information remained missing, when not covered. */
    missingInfo?: string;
}

/**
 * Friction signal captured during an otherwise possibly-successful run:
 * each one is documentation feedback that a binary pass/fail hides.
 */
export interface FrictionEvent {
    type: "SMOKE_TEST_FAILURE" | "RESEARCH_BOUNCE";
    /** Error text for smoke-test failures (truncated). */
    error?: string;
    /** Search query for research bounces. */
    query?: string;
    /** Free-text note (e.g. the doc-gap analysis the agent wrote while debugging). */
    note?: string;
}

/** Human verdict on a proposed documentation fix. */
export interface GapFeedback {
    stepIndex?: number;
    verdict: "ACCEPTED" | "REJECTED" | "EDITED";
    comment?: string;
    editedFix?: string;
    createdAt: string;
}

/** One HTTP request captured by the sandbox interceptor. */
export interface HttpTrafficEntry {
    method: string;
    url: string;
    requestBody?: string | null;
    responseStatus?: number | null;
    responseBody?: string | null;
    durationMs?: number | null;
    error?: string | null;
}

export interface StepResult {
    stepIndex: number;
    stepDescription: string;
    scriptContent: string;
    status: StepStatus;
    logs: string;
    contextAfter?: unknown;
    error?: string;
    relatedKnowledge?: unknown[];
    failureAnalysis?: FailureAnalysis;
    /** HTTP requests made by the user code during execution (intercepted by sandbox). */
    httpTrafficLog?: HttpTrafficEntry[];
    /** Docs-faithfulness: did the code use a documented API it was expected to?
     *  `false` = the agent dodged (used none of the expected symbols). `undefined`
     *  when no expected symbols were supplied (check not applicable). */
    docsFaithful?: boolean;
    /** Expected documented symbols the code failed to use (dodge detail). */
    docsUnfaithfulMissing?: string[];
}

export interface Report {
    id: ReportId;
    testSuiteId?: types.test.TestSuiteId;
    projectId: types.project.ProjectId;
    status: ReportStatus;
    type: "CODE_GENERATION" | "TEST_SCENARIO" | "MASTER_PLAN";
    summary?: string;
    initialContext: string;
    executionPlan: unknown;
    steps: StepResult[];
    detailedResults?: DetailedResults;
    /** Full agentic-loop transcript (CODE_GENERATION runs). */
    conversationHistory?: unknown[];
    createdAt: string;
    durationMs?: number;
    masterPlanId?: string;
    masterPlanGoals?: string[];
    masterPlanReports?: ReportId[];
    structuredSummary?: types.planner.StructuredMasterSummary;
    /** Research-phase documentation coverage breakdown. */
    coverageReport?: CoverageItem[];
    /** Friction signals (smoke-test failures, research bounces) captured mid-run. */
    frictionEvents?: FrictionEvent[];
    /** Human accept/reject verdicts on proposed documentation fixes. */
    gapFeedback?: GapFeedback[];
    /** ID of the master plan this report was re-run from (rerun flow only). */
    rerunFromMasterPlanId?: string;
}

export interface ListReport {
    id: ReportId;
    testSuiteId?: types.test.TestSuiteId;
    projectId?: types.project.ProjectId;
    status: ReportStatus;
    type?: "CODE_GENERATION" | "TEST_SCENARIO" | "MASTER_PLAN";
    createdAt: string;
    masterPlanId?: string;
    masterPlanGoals?: string[];
    structuredSummary?: types.planner.StructuredMasterSummary;
}

export interface ReportIdParam {
    reportId: ReportId;
}
