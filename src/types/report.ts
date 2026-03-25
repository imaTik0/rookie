import * as types from "./index.ts";

export type ReportId = string & { __reportId: never };
export type ReportStatus = "SUCCESS" | "FAILED";
export type DetailedResults = unknown;

export type DocumentationGap = "MISSING" | "AMBIGUOUS" | "INCORRECT" | "CONFIG" | "UNKNOWN";

export interface FailureAnalysis {
    errorMessage: string;
    failedFunction: string;
    documentationGap: DocumentationGap;
    reasoning: string;
    suggestedDocsFix: string;
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
}

export interface Report {
    id: ReportId;
    testSuiteId: types.test.TestSuiteId;
    projectId: types.project.ProjectId;
    status: ReportStatus;
    initialContext: string;
    executionPlan: unknown;
    steps: StepResult[];
    createdAt: Date;
    durationMs?: number;
}

export interface ListReport {
    id: ReportId;
    testSuiteId: types.test.TestSuiteId;
    status: ReportStatus;
    createdAt: string;
}

export interface ReportIdParam {
    reportId: ReportId;
}
