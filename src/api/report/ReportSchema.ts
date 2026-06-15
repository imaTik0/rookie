import { z } from "@hono/zod-openapi";
import { paginated, PaginationQuerySchema } from "../CommonSchema.ts";

export const ReportType = z.enum(["TEST_SCENARIO", "CODE_GENERATION", "MASTER_PLAN"])
    .describe("The type of the report.")
    .openapi({ example: "TEST_SCENARIO" });

const StepStatus = z.enum(["SUCCESS", "FAILED"])
    .openapi({ example: "SUCCESS" });

const FragmentVerificationSchema = z.object({
    verified: z.boolean()
        .describe("True when the pinpointed fragment was located in the actual docs corpus."),
    file: z.string().optional().describe("Best-matching documentation file."),
    lineStart: z.number().int().optional().describe("1-based first line of the match."),
    lineEnd: z.number().int().optional().describe("1-based last line of the match."),
    matchScore: z.number().describe("Similarity score 0..1 (1 = exact quote)."),
    matchedText: z.string().optional().describe("The actual text found in the file."),
}).openapi("FragmentVerification");

const FailureAnalysisSchema = z.object({
    errorMessage: z.string().describe("The key error line."),
    failedFunction: z.string().describe("The function/method that crashed."),
    documentationGap: z.enum([
        "MISSING",
        "AMBIGUOUS",
        "INCORRECT",
        "CONFIG",
        "ENVIRONMENT",
        "UNKNOWN",
    ]).describe("Semantic classification of the documentation gap."),
    reasoning: z.string().describe("Why the classifier chose this category."),
    suggestedDocsFix: z.string().describe("Concrete suggestion for the documentation."),
    pinpointedFragment: z.string().optional()
        .describe("The doc fragment the classifier blames (LLM quote)."),
    proposedFragment: z.string().optional()
        .describe("Corrected/improved version of that fragment."),
    confidence: z.number().optional()
        .describe("Self-consistency agreement: winning votes / total votes (0..1)."),
    votes: z.number().int().optional().describe("Number of classifier votes cast."),
    fragmentVerification: FragmentVerificationSchema.optional(),
}).openapi("FailureAnalysis");

const HttpTrafficEntrySchema = z.object({
    method: z.string(),
    url: z.string(),
    requestBody: z.string().nullish(),
    responseStatus: z.number().nullish(),
    responseBody: z.string().nullish(),
    durationMs: z.number().nullish(),
    error: z.string().nullish(),
}).openapi("HttpTrafficEntry");

const StepResultSchema = z.object({
    stepIndex: z.number().int()
        .describe("Order of the step in the sequence.")
        .openapi({ example: 1 }),
    stepDescription: z.string()
        .describe("Explanation of what this step does.")
        .openapi({ example: "Fetch user profile from API" }),
    scriptContent: z.string()
        .describe("The actual JavaScript code executed in Docker.")
        .openapi({ example: "const res = await fetch('...');" }),
    status: StepStatus,
    logs: z.string()
        .describe("Captured STDOUT and STDERR from the Docker container.")
        .openapi({ example: "STDOUT:\nRequest sent...\nSTDERR:\n" }),
    error: z.string().optional()
        .describe("Error message if the step failed (JSON stringified)."),
    contextAfter: z.any().optional()
        .describe("State of the context object after execution.")
        .openapi({ type: "object" }),
    relatedKnowledge: z.array(z.any()).optional()
        .describe("Relevant documents from VectorDB if step failed."),
    failureAnalysis: FailureAnalysisSchema.optional()
        .describe("Documentation-gap analysis for failed steps."),
    httpTrafficLog: z.array(HttpTrafficEntrySchema).optional()
        .describe("HTTP requests made by the user code during sandbox execution."),
});

const CoverageItemSchema = z.object({
    subtask: z.string().describe("Sub-task the research agent decomposed the goal into."),
    covered: z.boolean().describe("Whether the documentation covered this sub-task."),
    queriesUsed: z.array(z.string()).optional()
        .describe("Search queries the agent needed for this sub-task."),
    missingInfo: z.string().optional()
        .describe("What information was missing, when not covered."),
}).openapi("CoverageItem");

const FrictionEventSchema = z.object({
    type: z.enum(["SMOKE_TEST_FAILURE", "RESEARCH_BOUNCE"])
        .describe("Kind of friction captured mid-run."),
    error: z.string().optional().describe("Error text for smoke-test failures (truncated)."),
    query: z.string().optional().describe("Search query for research bounces."),
    note: z.string().optional().describe("Free-text context."),
}).openapi("FrictionEvent");

const GapFeedbackSchema = z.object({
    stepIndex: z.number().int().optional()
        .describe("Step whose proposed fix this verdict refers to."),
    verdict: z.enum(["ACCEPTED", "REJECTED", "EDITED"])
        .describe("Human verdict on the proposed documentation fix."),
    comment: z.string().optional(),
    editedFix: z.string().optional()
        .describe("Human-corrected fix text when verdict is EDITED."),
    createdAt: z.string().datetime(),
}).openapi("GapFeedback");

const DetailedResultsSchema = z.object({
    executionPlan: z.any().optional()
        .describe("The original JSON plan or code generated by the LLM.")
        .openapi({ type: "object" }),
    initialContext: z.string().optional()
        .describe("The initial state context provided to the test."),
    steps: z.array(StepResultSchema).optional()
        .describe("List of executed steps or generated code examples and their results."),
    durationMs: z.number().optional()
        .describe("Total execution time in milliseconds."),
    finalOutput: z.string().optional()
        .describe("Final Markdown output for code generation mode."),
});

const ReportId = z.string()
    .describe("Unique ID of the report.")
    .openapi({ example: "rep-d9a7f1" });

const TestSuiteId = z.string().optional()
    .describe("The ID of the test suite that generated this report (optional for MASTER_PLAN).")
    .openapi({ example: "ts-8f3b2e" });

const ReportStatus = z.enum(["PENDING", "RUNNING", "SUCCESS", "FAILED", "PARTIAL_FAILURE"])
    .describe("Current status of the test run.")
    .openapi({ example: "SUCCESS" });

const ReportSummary = z.string().optional()
    .describe("A brief summary of the results (e.g. 'Failed at step 3').")
    .openapi({ example: "Successfully executed 5 steps." });

const CreatedAt = z.string().datetime()
    .describe("Timestamp of creation.")
    .openapi({ example: "2025-10-27T11:00:00Z" });

const ProjectId = z.string()
    .describe("The ID of the project.")
    .openapi({ example: "proj-a4c1d" });

export const ReportSchema = z.object({
    id: ReportId,
    testSuiteId: TestSuiteId,
    projectId: ProjectId,
    status: ReportStatus,
    type: ReportType.default("TEST_SCENARIO"),
    summary: ReportSummary,
    initialContext: z.string().describe("Initial context"),
    executionPlan: z.any().describe("Execution plan"),
    steps: z.array(StepResultSchema).describe("Execution steps"),
    durationMs: z.number().optional().describe("Duration in ms"),
    detailedResults: DetailedResultsSchema.optional(),
    masterPlanGoals: z.array(z.string()).optional(),
    masterPlanId: z.string().optional(),
    masterPlanReports: z.array(z.string()).optional(),
    rerunFromMasterPlanId: z.string().optional()
        .describe(
            "ID of the master plan this report was re-run from (present only for rerun reports).",
        ),
    structuredSummary: z.any().optional(),
    coverageReport: z.array(CoverageItemSchema).optional()
        .describe("Research-phase documentation coverage breakdown."),
    frictionEvents: z.array(FrictionEventSchema).optional()
        .describe("Friction signals captured mid-run (hidden by binary pass/fail)."),
    gapFeedback: z.array(GapFeedbackSchema).optional()
        .describe("Human verdicts on proposed documentation fixes."),
    createdAt: CreatedAt,
}).openapi("Report");

export const CreateGapFeedbackSchema = z.object({
    stepIndex: z.number().int().optional().openapi({ example: 2 }),
    verdict: z.enum(["ACCEPTED", "REJECTED", "EDITED"]).openapi({ example: "ACCEPTED" }),
    comment: z.string().max(2000).optional(),
    editedFix: z.string().max(10000).optional(),
}).openapi("CreateGapFeedback");

export const GapFeedbackResponseSchema = GapFeedbackSchema;

export const DocsPatchQuerySchema = z.object({
    format: z.enum(["markdown", "diff"]).default("markdown").openapi({
        param: { name: "format", in: "query" },
        description: "markdown = PR-style proposal with diff blocks; diff = raw unified diff.",
    }),
});

export const ReportIdParam = z.object({
    reportId: ReportId.describe("The unique ID of the Report for URL path."),
});

export const ListReportItemSchema = z.object({
    id: ReportId,
    testSuiteId: TestSuiteId,
    projectId: ProjectId,
    status: ReportStatus,
    type: ReportType.optional(),
    createdAt: CreatedAt,
    masterPlanId: z.string().optional(),
    masterPlanGoals: z.array(z.string()).optional(),
    rerunFromMasterPlanId: z.string().optional(),
    structuredSummary: z.any().optional(),
});

export const ListReportSchema = z.array(ListReportItemSchema);

export const ReportListQuerySchema = PaginationQuerySchema.extend({
    projectId: z.string().optional().openapi({
        param: { name: "projectId", in: "query" },
        description: "Filter reports by the project they belong to.",
    }),
    testSuiteId: z.string().optional().openapi({
        param: { name: "testSuiteId", in: "query" },
        description: "Filter reports by the test suite that produced them.",
    }),
    status: ReportStatus.optional().openapi({
        param: { name: "status", in: "query" },
        description: "Filter by run status.",
    }),
    type: ReportType.optional().openapi({
        param: { name: "type", in: "query" },
        description: "Filter by report type.",
    }),
});

export const PaginatedReportListSchema = paginated(ListReportItemSchema).openapi(
    "PaginatedReports",
);

export type ReportType = z.infer<typeof ReportType>;
export type Report = z.infer<typeof ReportSchema>;
export type ReportDetailedResults = z.infer<typeof DetailedResultsSchema>;
export type ReportStepResult = z.infer<typeof StepResultSchema>;
export type ReportIdParam = z.infer<typeof ReportIdParam>;
export type ListReportSchema = z.infer<typeof ListReportSchema>;
