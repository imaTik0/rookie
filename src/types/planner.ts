import * as types from "./index.ts";

export type MasterPlanId = string & { __masterPlanId: never };

export interface MasterPlanReport {
    _id: MasterPlanId;
    projectId: types.project.ProjectId;
    goals: string[];
    reports: types.report.ReportId[];
    finalSummary: string;
    createdAt: Date;
}
