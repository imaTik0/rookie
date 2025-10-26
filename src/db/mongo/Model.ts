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
