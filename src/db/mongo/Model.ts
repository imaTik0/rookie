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
    testSuiteId?: types.test.TestSuiteId;
    projectId: types.project.ProjectId;
    status: types.report.ReportStatus;
    type: "CODE_GENERATION" | "TEST_SCENARIO" | "MASTER_PLAN";
    summary?: string;
    initialContext: string;
    executionPlan: unknown;
    steps: types.report.StepResult[];
    finalOutput?: string;
    createdAt: Date;
    durationMs?: number;
    masterPlanId?: string;
    masterPlanGoals?: string[];
    masterPlanReports?: types.report.ReportId[];
    structuredSummary?: types.planner.StructuredMasterSummary;
    coverageReport?: types.report.CoverageItem[];
    frictionEvents?: types.report.FrictionEvent[];
    gapFeedback?: types.report.GapFeedback[];
    /** ID of the master plan this report was re-run from (rerun flow only). */
    rerunFromMasterPlanId?: string;
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
    /** Sandbox npm install pins (name → version|"latest") for this suite's runs;
     *  used by the library-drift experiment to install `<pkg>@<version>`. */
    packageOverrides?: Record<string, string>;
    /** Docs-ablation arm: generate code without documentation (no RAG). */
    withoutDocs?: boolean;
    /** Pre-generated programs to run verbatim (frozen re-execution). */
    frozenPrograms?: string[];
    /** Documented API symbols the run should exercise (docs-faithfulness). */
    expectedApis?: string[];
    createdAt: Date;
    updatedAt: Date;
}

export interface JobModel {
    _id: types.job.JobId;
    kind: types.job.JobKind;
    status: types.job.JobStatus;
    params: Record<string, unknown>;
    result?: Record<string, unknown>;
    error?: string;
    progress?: string;
    createdAt: Date;
    startedAt?: Date;
    finishedAt?: Date;
}
