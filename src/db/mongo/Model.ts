import * as types from "../../types/index.ts";
import type { Binary } from "mongodb";

export interface File {
    _id: types.file.FileId;
    filename: string;
    mimetype: string;
    size: number;
    data: Binary;
    createdAt: Date;
    updatedAt: Date;
}

export interface Project {
    _id: types.project.ProjectId;
    projectName: string;
    files: types.file.FileId[];
    createdAt: Date;
    updatedAt: Date;
}

export interface PopulatedProject {
    _id: types.project.ProjectId;
    projectName: string;
    files: Omit<File, "data">[];
    createdAt: Date;
    updatedAt: Date;
}

export interface ReportModel {
    _id: types.report.ReportId;
    testSuiteId: types.test.TestSuiteId;
    projectId: types.project.ProjectId;
    status: types.report.ReportStatus;
    type: "CODE_GENERATION" | "TEST_SCENARIO";
    initialContext: string;
    executionPlan: unknown; // The raw JSON plan or code from LLM
    steps: types.report.StepResult[];
    finalOutput?: string;
    createdAt: Date;
    durationMs?: number;
}

export interface TestSuite {
    _id: string;
    projectId: types.project.ProjectId;
    initialContext: string;
    functionTemplate?: string;
    minimalStoryLength: number;
    maximalStoryLength: number;
    mode: "CODE_GENERATION" | "TEST_SCENARIO";
    userGoal?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface MasterPlanReport {
    _id: types.planner.MasterPlanId;
    projectId: types.project.ProjectId;
    goals: string[];
    reports: types.report.ReportId[];
    finalSummary: string;
    createdAt: Date;
}
