import { MongoDbConnection } from "../db/mongo/MongoDbManager.ts";
import * as db from "../db/mongo/Model.ts"; // Assuming Model exports ReportModel interface
import { BaseRepository } from "../db/mongo/BaseRepository.ts";
import * as types from "../types/index.ts";

// Define the DB Model interface if not already in Model.ts
// export interface ReportModel extends Omit<types.report.Report, "id"> {
//     _id: string;
// }

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
            _id: this.generateId(), // BaseRepository likely provides this or use new ObjectId()
            testSuiteId: data.testSuiteId,
            projectId: data.projectId,
            status: data.status,
            initialContext: data.initialContext,
            executionPlan: data.executionPlan,
            steps: data.steps,
            createdAt: new Date(),
            durationMs: data.durationMs || 0,
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
    ): Promise<
        {
            reports: Pick<db.ReportModel, "_id" | "status" | "createdAt" | "testSuiteId">[];
            total: number;
        }
    > {
        const { page, limit } = pagination;
        const skip = (page - 1) * limit;
        const collection = this.getCollection();

        // Only fetch metadata, not the heavy steps/logs
        const projection = {
            steps: 0,
            executionPlan: 0,
            initialContext: 0,
        };

        const [reports, total] = await Promise.all([
            collection.find({}, { projection }).sort({ createdAt: -1 }).skip(skip).limit(limit)
                .toArray(),
            collection.countDocuments(),
        ]);

        return { reports: reports as any, total };
    }

    async delete(reportId: types.report.ReportId): Promise<boolean> {
        const result = await this.getCollection().deleteOne({ _id: reportId });
        return result.deletedCount === 1;
    }
}
