// src/controller/ReportController.ts

import type { RouteHandler } from "@hono/zod-openapi";
import { Controller, Delete, Get, Post } from "../Decorator.ts";
import { ReportRoutes } from "./ReportRoute.ts";
import { ReportService } from "../../service/ReportService.ts";
import { buildMeta } from "../CommonSchema.ts";
import * as types from "../../types/index.ts";

@Controller("/reports")
export class ReportController {
    constructor(
        private reportService: ReportService,
    ) {}

    @Get(ReportRoutes.ListReportsRoute)
    listReports: RouteHandler<typeof ReportRoutes.ListReportsRoute> = async (c) => {
        const { page, limit, projectId, testSuiteId, status, type } = c.req.valid("query");

        const { reports, total } = await this.reportService.listReports(page, limit, {
            projectId: projectId as types.project.ProjectId | undefined,
            testSuiteId: testSuiteId as types.test.TestSuiteId | undefined,
            status,
            type,
        });

        return c.json({ items: reports, meta: buildMeta(total, page, limit) }, 200);
    };

    @Get(ReportRoutes.GetReportRoute)
    getReport: RouteHandler<typeof ReportRoutes.GetReportRoute> = async (c) => {
        const { reportId } = c.req.valid("param");
        const report = await this.reportService.getReport(reportId as types.report.ReportId);
        if (!report) {
            return c.json({ code: 404, message: "Report not found" }, 404);
        }
        return c.json(report, 200);
    };

    @Delete(ReportRoutes.DeleteReportRoute)
    deleteReport: RouteHandler<typeof ReportRoutes.DeleteReportRoute> = async (c) => {
        const { reportId } = c.req.valid("param");
        const deleted = await this.reportService.deleteReport(reportId as types.report.ReportId);
        if (!deleted) {
            return c.json({ message: "Report not found or could not be deleted" }, 404);
        }
        return c.body(null, 204);
    };

    @Get(ReportRoutes.GetDocsPatchRoute)
    getDocsPatch: RouteHandler<typeof ReportRoutes.GetDocsPatchRoute> = async (c) => {
        const { reportId } = c.req.valid("param");
        const { format } = c.req.valid("query");
        const patch = await this.reportService.generateDocsPatch(
            reportId as types.report.ReportId,
            format,
        );
        if (!patch) {
            return c.json({ code: 404, message: "Report not found" }, 404);
        }
        return c.text(patch.content, 200, {
            "X-Patched-Clusters": String(patch.patchedClusters),
            "X-Unpatched-Clusters": String(patch.unpatchedClusters),
        });
    };

    @Post(ReportRoutes.AddGapFeedbackRoute)
    addGapFeedback: RouteHandler<typeof ReportRoutes.AddGapFeedbackRoute> = async (c) => {
        const { reportId } = c.req.valid("param");
        const body = c.req.valid("json");
        const stored = await this.reportService.addGapFeedback(
            reportId as types.report.ReportId,
            body,
        );
        if (!stored) {
            return c.json({ code: 404, message: "Report not found" }, 404);
        }
        return c.json(stored, 201);
    };
}
