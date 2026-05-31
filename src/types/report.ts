import * as types from "./index.ts";

export type ReportId = string & { __reportId: never };
export type ReportStatus = "SUCCESS" | "FAILED";
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

export interface FailureAnalysis {
    errorMessage: string;
    failedFunction: string;
    documentationGap: DocumentationGap;
    reasoning: string;
    suggestedDocsFix: string;
    pinpointedFragment?: string;
    proposedFragment?: string;
}

export interface StepResult {
    stepIndex: number;
    stepDescription: string;
    scriptContent: string;
    status: ReportStatus;
    logs: string;
    contextAfter?: unknown;
    error?: string;
    relatedKnowledge?: unknown[];
    failureAnalysis?: FailureAnalysis;
    bashSetup?: string;
    environment?: string;
    dependencies?: string[];
    command?: string;
}

export interface Report {
    id: ReportId;
    testSuiteId?: types.test.TestSuiteId;
    projectId: types.project.ProjectId;
    status: ReportStatus;
    type: "CODE_GENERATION" | "TEST_SCENARIO" | "MASTER_PLAN";
    initialContext: string;
    executionPlan: unknown;
    steps: StepResult[];
    detailedResults?: DetailedResults;
    conversationHistory?: any[];
    createdAt: Date;
    durationMs?: number;
    masterPlanId?: string;
    masterPlanGoals?: string[];
    masterPlanReports?: ReportId[];
    structuredSummary?: types.planner.StructuredMasterSummary;
}

export interface ListReport {
    id: ReportId;
    testSuiteId?: types.test.TestSuiteId;
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
