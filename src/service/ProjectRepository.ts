import { MongoDbConnection } from "../db/mongo/MongoDbManager.ts";
import * as types from "../types/index.ts";
import * as db from "../db/mongo/Model.ts";
import { BaseRepository } from "../db/mongo/BaseRepository.ts";
import { FileRepository } from "./FileRepository.ts";

export class ProjectRepository extends BaseRepository<types.project.ProjectId, db.Project> {
    static readonly COLLECTION_NAME = "projects";

    constructor(
        mongoDbConnection: MongoDbConnection,
    ) {
        super(mongoDbConnection, ProjectRepository.COLLECTION_NAME);
    }

    async create(
        data: { projectName: string; fileIds?: types.file.FileId[] },
    ): Promise<db.Project> {
        const newProject: db.Project = {
            _id: this.generateId(),
            projectName: data.projectName,
            files: data.fileIds || [],
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await this.getCollection().insertOne(newProject);
        return newProject;
    }

    async get(projectId: types.project.ProjectId): Promise<db.Project | null> {
        return await this.getCollection().findOne({
            _id: projectId,
        });
    }

    async getPopulated(projectId: types.project.ProjectId): Promise<db.PopulatedProject | null> {
        const pipeline = [
            { $match: { _id: projectId } },
            {
                $lookup: {
                    from: FileRepository.COLLECTION_NAME,
                    localField: "files",
                    foreignField: "_id",
                    as: "populatedFiles",
                    pipeline: [
                        { $project: { data: 0 } },
                    ],
                },
            },
            { $addFields: { files: "$populatedFiles" } },
            { $project: { populatedFiles: 0 } },
            { $sort: { "files.createdAt": 1 } },
        ];

        const result = await this.getCollection().aggregate(pipeline).toArray();
        return result.length > 0 ? (result[0] as unknown as db.PopulatedProject) : null;
    }

    async listPopulated(
        pagination: { page: number; limit: number },
    ) {
        const { page, limit } = pagination;
        const skip = (page - 1) * limit;
        const collection = this.getCollection();

        const pipeline = [
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: limit },
            {
                $lookup: {
                    from: FileRepository.COLLECTION_NAME,
                    localField: "files",
                    foreignField: "_id",
                    as: "populatedFiles",
                    pipeline: [
                        { $project: { data: 0 } },
                    ],
                },
            },
            { $addFields: { files: "$populatedFiles" } },
            { $project: { populatedFiles: 0 } },
        ];

        const [projects, total] = await Promise.all([
            collection.aggregate(pipeline).toArray(),
            collection.countDocuments(),
        ]);

        return { projects: projects as db.PopulatedProject[], total };
    }

    async update(
        projectId: types.project.ProjectId,
        data: { projectName?: string; fileIds?: types.file.FileId[] },
    ): Promise<db.Project | null> {
        const updateDoc: { $set: { [key: string]: unknown } } = { $set: {} };
        if (data.projectName) {
            updateDoc.$set.projectName = data.projectName;
        }
        if (data.fileIds) {
            updateDoc.$set.files = data.fileIds;
        }
        if (Object.keys(updateDoc.$set).length === 0) {
            return this.get(projectId);
        }
        updateDoc.$set.updatedAt = new Date();
        const result = await this.getCollection().findOneAndUpdate(
            { _id: projectId },
            updateDoc,
            { returnDocument: "after" },
        );
        return result;
    }

    async delete(projectId: types.project.ProjectId): Promise<boolean> {
        const result = await this.getCollection().deleteOne({ _id: projectId });
        return result.deletedCount === 1;
    }

    async addFiles(
        projectId: types.project.ProjectId,
        fileIds: types.file.FileId[],
    ): Promise<db.Project | null> {
        const result = await this.getCollection().findOneAndUpdate(
            { _id: projectId },
            {
                $addToSet: { files: { $each: fileIds } },
                $set: { updatedAt: new Date() },
            },
            { returnDocument: "after" },
        );
        return result;
    }

    async removeFiles(
        projectId: types.project.ProjectId,
        fileIds: types.file.FileId[],
    ): Promise<db.Project | null> {
        const result = await this.getCollection().findOneAndUpdate(
            { _id: projectId },
            {
                $pullAll: { files: fileIds },
                $set: { updatedAt: new Date() },
            },
            { returnDocument: "after" },
        );
        return result;
    }

    async removeFileFromAllProjects(fileId: types.file.FileId): Promise<void> {
        await this.getCollection().updateMany(
            { files: fileId },
            { $pull: { files: fileId } },
        );
    }

    async findProjectIdsByFileId(
        fileId: types.file.FileId,
    ): Promise<types.project.ProjectId[]> {
        const docs = await this.getCollection()
            .find({ files: fileId })
            .project({ _id: 1 })
            .toArray();
        return docs.map((d) => d._id as types.project.ProjectId);
    }
}
