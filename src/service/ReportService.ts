import { Injectable } from "../ioc/decorator.ts";
import { ReportFilter, ReportRepository } from "../db/mongo/ReportRepository.ts";
import { ProjectRepository } from "../db/mongo/ProjectRepository.ts";
import { FileService } from "./FileService.ts";
import * as db from "../db/mongo/Model.ts";
import * as types from "../types/index.ts";
import { collectFindings } from "../feedback/gapAggregate.ts";
import { clusterGaps } from "../feedback/gapAggregate.ts";
import { generateDocsPatch } from "../feedback/docsPatch.ts";
import { CorpusFile, corpusFromFiles } from "../feedback/fragmentVerify.ts";

@Injectable()
export class ReportService {
    constructor(
        private reportRepository: ReportRepository,
        private projectRepository: ProjectRepository,
        private fileService: FileService,
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
            summary: model.summary,
            executionPlan: model.executionPlan,
            initialContext: model.initialContext,
            steps: model.steps,
            durationMs: model.durationMs,
            masterPlanId: model.masterPlanId,
            masterPlanGoals: model.masterPlanGoals,
            masterPlanReports: model.masterPlanReports,
            structuredSummary: model.structuredSummary,
            coverageReport: model.coverageReport,
            frictionEvents: model.frictionEvents,
            gapFeedback: model.gapFeedback,
            createdAt: model.createdAt.toISOString(),
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
            projectId: model.projectId,
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
        filter: ReportFilter = {},
    ): Promise<{ reports: types.report.ListReport[]; total: number }> {
        const { reports: reportModels, total } = await this.reportRepository.listSlim(
            { page, limit },
            filter,
        );

        const reports = reportModels.map((model) => this.toApiListReport(model as db.ReportModel));

        return { reports, total };
    }

    async deleteReport(reportId: types.report.ReportId): Promise<boolean> {
        return await this.reportRepository.delete(reportId);
    }

    async addGapFeedback(
        reportId: types.report.ReportId,
        feedback: Omit<types.report.GapFeedback, "createdAt">,
    ): Promise<types.report.GapFeedback | null> {
        const full: types.report.GapFeedback = {
            ...feedback,
            createdAt: new Date().toISOString(),
        };
        const ok = await this.reportRepository.addGapFeedback(reportId, full);
        return ok ? full : null;
    }

    async generateDocsPatch(
        reportId: types.report.ReportId,
        format: "markdown" | "diff",
    ): Promise<{ content: string; patchedClusters: number; unpatchedClusters: number } | null> {
        const report = await this.reportRepository.get(reportId);
        if (!report) return null;

        let reports: db.ReportModel[];
        if (report.type === "MASTER_PLAN") {
            const children = await Promise.all(
                (report.masterPlanReports ?? []).map((id) => this.reportRepository.get(id)),
            );
            reports = children.filter((r): r is db.ReportModel => !!r);
        } else {
            reports = [report];
        }

        const goalByReportId = new Map<string, string>();
        for (const g of report.structuredSummary?.goalsBreakdown ?? []) {
            if (g.reportId) goalByReportId.set(g.reportId, g.goal);
        }

        const findings = collectFindings(
            reports.map((r) => ({
                goal: goalByReportId.get(r._id) ?? `report ${r._id}`,
                reportId: r._id,
                steps: r.steps ?? [],
            })),
        );

        const corpus = await this.loadProjectCorpus(report.projectId);
        const result = generateDocsPatch(clusterGaps(findings), corpus);
        return {
            content: format === "diff" ? result.patch : result.markdown,
            patchedClusters: result.patchedClusters,
            unpatchedClusters: result.unpatchedClusters,
        };
    }

    private async loadProjectCorpus(
        projectId: types.project.ProjectId,
    ): Promise<CorpusFile[]> {
        const project = await this.projectRepository.get(projectId);
        if (!project) return [];
        const files = await Promise.all(
            project.files.map((fileId) => this.fileService.downloadFile(fileId)),
        );
        return corpusFromFiles(
            files.filter((f): f is NonNullable<typeof f> => !!f),
        );
    }
}
