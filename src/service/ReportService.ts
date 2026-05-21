import { ReportRepository } from "./ReportRepository.ts";
import * as db from "../db/mongo/Model.ts";
import * as types from "../types/index.ts";

export class ReportService {
    constructor(
        private reportRepository: ReportRepository,
    ) {}

    public mapReportToApi(model: db.ReportModel): types.report.Report {
        return this.toApiReport(model);
    }

    private toApiReport(model: db.ReportModel): types.report.Report {
        return {
            id: model._id,
            projectId: model.projectId,
            testSuiteId: model.testSuiteId,
            status: model.status,
            type: model.type,
            executionPlan: model.executionPlan,
            initialContext: model.initialContext,
            steps: model.steps,
            durationMs: model.durationMs,
            masterPlanId: model.masterPlanId,
            masterPlanGoals: model.masterPlanGoals,
            masterPlanReports: model.masterPlanReports,
            structuredSummary: model.structuredSummary,
            createdAt: model.createdAt.toISOString() as unknown as Date,
            detailedResults: {
                executionPlan: model.executionPlan,
                initialContext: model.initialContext,
                steps: model.steps,
                durationMs: model.durationMs,
                finalOutput: model.finalOutput,
            },
        };
    }

    private toApiListReport(model: db.ReportModel): types.report.ListReport {
        return {
            id: model._id,
            testSuiteId: model.testSuiteId,
            status: model.status,
            type: model.type,
            masterPlanId: model.masterPlanId,
            masterPlanGoals: model.masterPlanGoals,
            structuredSummary: model.structuredSummary,
            createdAt: model.createdAt.toISOString(),
        };
    }

    async getReport(reportId: types.report.ReportId): Promise<types.report.Report | null> {
        const reportModel = await this.reportRepository.get(reportId);
        if (!reportModel) {
            return null;
        }
        return this.toApiReport(reportModel);
    }

    async listReports(
        page: number,
        limit: number,
    ): Promise<{ reports: types.report.ListReport[]; total: number }> {
        const { reports: reportModels, total } = await this.reportRepository.listSlim({
            page,
            limit,
        });

        const reports = reportModels.map((model) => this.toApiListReport(model as db.ReportModel));

        return { reports, total };
    }

    async deleteReport(reportId: types.report.ReportId): Promise<boolean> {
        return await this.reportRepository.delete(reportId);
    }
}
