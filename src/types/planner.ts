import * as types from "./index.ts";

export type MasterPlanId = string & { __masterPlanId: never };

export interface GoalBreakdown {
    goal: string;
    status: string;
    reportId: types.report.ReportId | null;
    keyFindings: string;
}

export interface DocumentationGapDetail {
    fragment: string;
    proposedFix: string;
    affectedGoals: string[];
    file?: string;
    /** Gap category (computed from clustered findings). */
    documentationGap?: string;
    /** 1-based location in the verified file, when grounded. */
    lineStart?: number;
    lineEnd?: number;
    /** True when the fragment was located in the actual docs corpus. */
    verified?: boolean;
    /** Number of failing executions that hit this gap. */
    occurrences?: number;
    /** Mean classifier self-consistency confidence (0..1). */
    meanConfidence?: number;
    /** Whether this gap is new, persisted from a prior run, or recently resolved. */
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

export interface MasterPlanReport {
    _id: MasterPlanId;
    projectId: types.project.ProjectId;
    goals: string[];
    reports: types.report.ReportId[];
    finalSummary: string;
    structuredSummary?: StructuredMasterSummary;
    createdAt: Date;
}
