// src/controller/ReportController.ts

import type { RouteHandler } from "@hono/zod-openapi";
import { Controller, Delete, Get } from "../Decorator.ts";
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
}
