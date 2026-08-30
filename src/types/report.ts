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
    confidence?: number;
    votes?: number;
    fragmentVerification?: FragmentVerification;
}

export interface CoverageItem {
    subtask: string;
    covered: boolean;
    queriesUsed?: string[];
    missingInfo?: string;
}

export interface FrictionEvent {
    type: "SMOKE_TEST_FAILURE" | "RESEARCH_BOUNCE";
    error?: string;
    query?: string;
    note?: string;
}

export interface GapFeedback {
    stepIndex?: number;
    verdict: "ACCEPTED" | "REJECTED" | "EDITED";
    comment?: string;
    editedFix?: string;
    createdAt: string;
}

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
    httpTrafficLog?: HttpTrafficEntry[];
    docsFaithful?: boolean;
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
    conversationHistory?: unknown[];
    createdAt: string;
    durationMs?: number;
    masterPlanId?: string;
    masterPlanGoals?: string[];
    masterPlanReports?: ReportId[];
    structuredSummary?: types.planner.StructuredMasterSummary;
    coverageReport?: CoverageItem[];
    frictionEvents?: FrictionEvent[];
    gapFeedback?: GapFeedback[];
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
