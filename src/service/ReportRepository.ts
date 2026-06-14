import { MongoDbConnection } from "../db/mongo/MongoDbManager.ts";
import * as db from "../db/mongo/Model.ts";
import { BaseRepository } from "../db/mongo/BaseRepository.ts";
import * as types from "../types/index.ts";

export interface ReportFilter {
    projectId?: types.project.ProjectId;
    testSuiteId?: types.test.TestSuiteId;
    /** Matched against the stored status; accepts any string for forward-compat. */
    status?: string;
    type?: db.ReportModel["type"];
}

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
            _id: this.generateId(),
            testSuiteId: data.testSuiteId,
            projectId: data.projectId,
            status: data.status,
            type: data.type,
            initialContext: data.initialContext,
            executionPlan: data.executionPlan,
            steps: data.steps,
            finalOutput: data.detailedResults?.finalOutput,
            masterPlanGoals: data.masterPlanGoals,
            masterPlanReports: data.masterPlanReports,
            structuredSummary: data.structuredSummary,
            coverageReport: data.coverageReport,
            frictionEvents: data.frictionEvents,
            rerunFromMasterPlanId: data.rerunFromMasterPlanId,
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
        filter: ReportFilter = {},
    ): Promise<{ reports: Partial<db.ReportModel>[]; total: number }> {
        const { page, limit } = pagination;
        const skip = (page - 1) * limit;
        const collection = this.getCollection();

        const query: Record<string, unknown> = {};
        if (filter.projectId) query.projectId = filter.projectId;
        if (filter.testSuiteId) query.testSuiteId = filter.testSuiteId;
        if (filter.status) query.status = filter.status;
        if (filter.type) query.type = filter.type;

        const projection = {
            steps: 0,
            executionPlan: 0,
            initialContext: 0,
            masterPlanReports: 0,
        };

        const [reports, total] = await Promise.all([
            collection.find(query, { projection }).sort({ createdAt: -1 }).skip(skip).limit(limit)
                .toArray(),
            collection.countDocuments(query),
        ]);

        return {
            reports: reports as unknown as Partial<db.ReportModel>[],
            total,
        };
    }

    /** Append a human verdict on a proposed documentation fix. */
    async addGapFeedback(
        reportId: types.report.ReportId,
        feedback: types.report.GapFeedback,
    ): Promise<boolean> {
        const result = await this.getCollection().updateOne(
            { _id: reportId },
            { $push: { gapFeedback: feedback } as never },
        );
        return result.matchedCount === 1;
    }

    async setMasterPlanId(
        reportId: types.report.ReportId,
        masterPlanId: string,
    ): Promise<void> {
        await this.getCollection().updateOne(
            { _id: reportId },
            { $set: { masterPlanId } },
        );
    }

    async delete(reportId: types.report.ReportId): Promise<boolean> {
        const result = await this.getCollection().deleteOne({ _id: reportId });
        return result.deletedCount === 1;
    }
}
