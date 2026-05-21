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
