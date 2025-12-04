import * as types from "./index.ts";

export type ReportId = string & { __reportId: never };
export type ReportStatus = "SUCCESS" | "FAILED";
export type DetailedResults = unknown;

export interface StepResult {
    stepIndex: number;
    stepDescription: string;
    scriptContent: string; // The code that was executed
    status: "SUCCESS" | "FAILED";
    logs: string; // Captured stdout/stderr from Docker
    contextAfter?: unknown; // The context state after execution
    error?: string; // Error message if failed
    relatedKnowledge?: unknown[]; // Results from VectorDB if failed
}

export interface Report {
    id: ReportId;
    testSuiteId: types.test.TestSuiteId;
    projectId: types.project.ProjectId;
    status: ReportStatus;
    initialContext: string;
    executionPlan: unknown; // The raw JSON plan from LLM
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
