// API types mirrored from the backend zod schemas (src/api/**).

export interface PaginationMeta {
    totalItems: number;
    totalPages: number;
    currentPage: number;
    itemsPerPage: number;
}

export interface Paginated<T> {
    items: T[];
    meta: PaginationMeta;
}

export interface ApiErrorBody {
    code?: number;
    message: string;
}

// ---------- Reports ----------

export type ReportStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "PARTIAL_FAILURE";
export type ReportType = "TEST_SCENARIO" | "CODE_GENERATION" | "MASTER_PLAN";

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

export type GapVerdict = "ACCEPTED" | "REJECTED" | "EDITED";

export interface GapFeedback {
    stepIndex?: number;
    verdict: GapVerdict;
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
    status: "SUCCESS" | "FAILED";
    logs: string;
    error?: string;
    contextAfter?: unknown;
    relatedKnowledge?: unknown[];
    failureAnalysis?: FailureAnalysis;
    httpTrafficLog?: HttpTrafficEntry[];
}

export interface DetailedResults {
    finalOutput?: string;
    executionPlan?: unknown;
    initialContext?: string;
    steps?: StepResult[];
    durationMs?: number;
    [key: string]: unknown;
}

export interface GoalBreakdown {
    goal: string;
    status: string;
    reportId: string | null;
    keyFindings: string;
}

export interface DocumentationGapDetail {
    fragment: string;
    proposedFix: string;
    affectedGoals: string[];
    file?: string;
    documentationGap?: string;
    lineStart?: number;
    lineEnd?: number;
    verified?: boolean;
    occurrences?: number;
    meanConfidence?: number;
    regressionStatus?: "NEW" | "PERSISTED" | "RESOLVED";
}

export interface TopFailingFunction {
    functionName: string;
    count: number;
    goals: string[];
}

export interface StructuredMasterSummary {
    executiveSummary: string;
    overallPassRate: number;
    failureTaxonomy: Record<string, number>;
    topFailingFunctions: TopFailingFunction[];
    goalsBreakdown: GoalBreakdown[];
    documentationGapDetails: DocumentationGapDetail[];
    recommendations: string[];
}

export interface Report {
    id: string;
    testSuiteId?: string;
    projectId: string;
    status: ReportStatus;
    type: ReportType;
    summary?: string;
    initialContext: string;
    executionPlan: unknown;
    steps: StepResult[];
    durationMs?: number;
    detailedResults?: DetailedResults;
    masterPlanGoals?: string[];
    masterPlanId?: string;
    masterPlanReports?: string[];
    /** Set when this report was produced by /planner/rerun (ID of the source plan). */
    rerunFromMasterPlanId?: string;
    structuredSummary?: StructuredMasterSummary;
    coverageReport?: CoverageItem[];
    frictionEvents?: FrictionEvent[];
    gapFeedback?: GapFeedback[];
    createdAt: string;
}

export interface ListReportItem {
    id: string;
    testSuiteId?: string;
    projectId: string;
    status: ReportStatus;
    type?: ReportType;
    createdAt: string;
    masterPlanId?: string;
    masterPlanGoals?: string[];
    rerunFromMasterPlanId?: string;
    structuredSummary?: StructuredMasterSummary;
}

// ---------- Projects & Files ----------

export interface FileMeta {
    id: string;
    filename: string;
    mimetype: string;
    size: number;
    createdAt: string;
}

export interface Project {
    id: string;
    projectName: string;
    files: FileMeta[];
    createdAt: string;
    updatedAt: string;
}

export interface PaginatedProjects {
    projects: Project[];
    meta: PaginationMeta;
}

export interface PaginatedFiles {
    files: FileMeta[];
    meta: PaginationMeta;
}

// ---------- Test suites ----------

export type TestSuiteMode = "TEST_SCENARIO" | "CODE_GENERATION";

export interface TestSuite {
    id: string;
    projectId: string;
    mode: TestSuiteMode;
    initialContext: string;
    functionTemplate?: string;
    userGoal?: string;
    minimalStoryLength: number;
    maximalStoryLength: number;
    createdAt: string;
    updatedAt: string;
}

export interface CreateTestSuite {
    projectId: string;
    mode: TestSuiteMode;
    initialContext: string;
    functionTemplate?: string;
    userGoal?: string;
    minimalStoryLength: number;
    maximalStoryLength: number;
}

// ---------- Jobs ----------

export type JobKind = "EXECUTE_TEST_SUITE" | "CRAWL_DOCS";
export type JobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export interface Job {
    id: string;
    kind: JobKind;
    status: JobStatus;
    params: Record<string, unknown>;
    result?: Record<string, unknown>;
    error?: string;
    progress?: string;
    createdAt: string;
    startedAt?: string;
    finishedAt?: string;
}

// ---------- Planner stream ----------

export interface PlannerEvent {
    type: string;
    [key: string]: unknown;
}
