import { MongoDbConnection } from "../db/mongo/MongoDbManager.ts";
import * as types from "../types/index.ts";
import * as db from "../db/mongo/Model.ts";
import { BaseRepository } from "../db/mongo/BaseRepository.ts";
import { Binary } from "mongodb";
import { Buffer } from "node:buffer";

export class FileRepository extends BaseRepository<types.file.FileId, db.File> {
    static readonly COLLECTION_NAME = "files";

    constructor(
        mongoDbConnection: MongoDbConnection,
    ) {
        super(mongoDbConnection, FileRepository.COLLECTION_NAME);
    }

    async create(
        fileData: { filename: string; mimetype: string; size: number; data: Buffer },
    ): Promise<db.File> {
        const newFile: db.File = {
            _id: this.generateId(), // ID is generated here
            ...fileData,
            data: new Binary(fileData.data), // Convert Buffer to BSON Binary
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await this.getCollection().insertOne(newFile);
        return newFile;
    }

    async get(fileId: types.file.FileId): Promise<db.File | null> {
        return await this.getCollection().findOne({
            _id: fileId,
        });
    }

    async getMetadataByIds(fileIds: types.file.FileId[]): Promise<Omit<db.File, "data">[]> {
        return await this.getCollection().find(
            { _id: { $in: fileIds } },
            { projection: { data: 0 } },
        ).toArray();
    }

    async delete(fileId: types.file.FileId): Promise<boolean> {
        const result = await this.getCollection().deleteOne({ _id: fileId });
        return result.deletedCount === 1;
    }

    async listPaginated(
        pagination: { page: number; limit: number },
    ): Promise<{ files: Omit<db.File, "data">[]; total: number }> {
        const { page, limit } = pagination;
        const skip = (page - 1) * limit;
        const collection = this.getCollection();

        const [files, total] = await Promise.all([
            collection.find(
                {},
                {
                    projection: { data: 0 }, // <-- CRITICAL: Exclude binary data
                    sort: { createdAt: -1 },
                    skip: skip,
                    limit: limit,
                },
            ).toArray(),
            collection.countDocuments(),
        ]);

        return { files, total };
    }
}
