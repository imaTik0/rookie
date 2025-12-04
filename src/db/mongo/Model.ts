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
    testSuiteId: types.report.TestSuiteId;
    status: types.report.ReportStatus;
    summary?: string;
    detailedResults?: types.report.DetailedResults;
    createdAt: Date;
}

export interface TestSuite {
    _id: string;
    projectId: types.project.ProjectId;
    initialContext: string;
    functionTemplate: string;
    minimalStoryLength: number;
    maximalStoryLength: number;
    createdAt: Date;
    updatedAt: Date;
}
