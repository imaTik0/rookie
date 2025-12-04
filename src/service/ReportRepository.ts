// src/repository/ReportRepository.ts

import { MongoDbConnection } from "../db/mongo/MongoDbManager.ts";
import * as db from "../db/mongo/Model.ts";
import { BaseRepository } from "../db/mongo/BaseRepository.ts";
import * as types from "../types/index.ts";

export class ReportRepository extends BaseRepository<types.report.ReportId, db.ReportModel> {
    static readonly COLLECTION_NAME = "reports";

    constructor(
        mongoDbConnection: MongoDbConnection,
    ) {
        super(mongoDbConnection, ReportRepository.COLLECTION_NAME);
    }

    async create(
        data: Omit<types.report.Report, "id" | "createdAt">,
    ): Promise<db.ReportModel> {
        const newReport: db.ReportModel = {
            _id: this.generateId() as types.report.ReportId,
            testSuiteId: data.testSuiteId,
            status: data.status,
            summary: data.summary,
            detailedResults: data.detailedResults,
            createdAt: new Date(),
        };

        await this.getCollection().insertOne(newReport);
        return newReport;
    }

    async get(reportId: types.report.ReportId): Promise<db.ReportModel | null> {
        return await this.getCollection().findOne({
            _id: reportId,
        });
    }

    async listSlim(
        pagination: { page: number; limit: number },
    ): Promise<{ reports: Omit<db.ReportModel, "detailedResults" | "summary">[]; total: number }> {
        const { page, limit } = pagination;
        const skip = (page - 1) * limit;
        const collection = this.getCollection();

        const projection: Record<string, 0 | 1> = {
            detailedResults: 0,
            summary: 0,
        };

        const [reports, total] = await Promise.all([
            collection.find({}, { projection }).sort({ createdAt: -1 }).skip(skip).limit(limit)
                .toArray(),
            collection.countDocuments(),
        ]);

        return { reports: reports as Omit<db.ReportModel, "detailedResults" | "summary">[], total };
    }

    async delete(reportId: types.report.ReportId): Promise<boolean> {
        const result = await this.getCollection().deleteOne({ _id: reportId });
        return result.deletedCount === 1;
    }
}
