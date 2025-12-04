export type ReportId = string & { __reportId: never };
export type TestSuiteId = string & { __testSuiteId: never };
export type ReportStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
export type DetailedResults = unknown;

export interface Report {
    id: ReportId;
    testSuiteId: TestSuiteId;
    status: ReportStatus;
    summary?: string;
    detailedResults?: DetailedResults;
    createdAt: string;
}

export interface ListReport {
    id: ReportId;
    testSuiteId: TestSuiteId;
    status: ReportStatus;
    createdAt: string;
}

export interface ReportIdParam {
    reportId: ReportId;
}
