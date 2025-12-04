import { z } from "@hono/zod-openapi";

const ReportId = z.string()
    .describe("Unique ID of the report.")
    .openapi({ example: "rep-d9a7f1" });

const TestSuiteId = z.string()
    .describe("The ID of the test suite that generated this report.")
    .openapi({ example: "ts-8f3b2e" });

const ReportStatus = z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED"])
    .describe("Current status of the test run.")
    .openapi({ example: "COMPLETED" });

const ReportSummary = z.string().optional()
    .describe("A brief summary of the results.")
    .openapi({ example: "Test completed successfully with 95% pass rate." });

const DetailedResults = z.any().optional()
    .describe("Detailed JSON results of the execution.")
    .openapi({ example: { total: 20, passed: 19, failed: 1, errors: [] } });

const CreatedAt = z.string().datetime()
    .describe("Timestamp of creation.")
    .openapi({ example: "2025-10-27T11:00:00Z" });

export const ReportSchema = z.object({
    id: ReportId,
    testSuiteId: TestSuiteId,
    status: ReportStatus,
    summary: ReportSummary,
    detailedResults: DetailedResults,
    createdAt: CreatedAt,
});

export const ReportIdParam = z.object({
    reportId: ReportId.describe("The unique ID of the Report for URL path."),
});

export const ListReportSchema = z.array(ReportSchema.omit({
    detailedResults: true,
    summary: true,
}));

export type Report = z.infer<typeof ReportSchema>;
export type ReportIdParam = z.infer<typeof ReportIdParam>;
export type ListReportSchema = z.infer<typeof ListReportSchema>;
