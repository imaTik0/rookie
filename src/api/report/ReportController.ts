// src/controller/ReportController.ts

import type { RouteHandler } from "@hono/zod-openapi";
import { Controller, Delete, Get } from "../Decorator.ts";
import { ReportRoutes } from "./ReportRoute.ts";
import { ReportService } from "../../service/ReportService.ts";
import * as types from "../../types/index.ts";

@Controller("/reports")
export class ReportController {
    constructor(
        private reportService: ReportService,
    ) {}

    @Get(ReportRoutes.ListReportsRoute)
    listReports: RouteHandler<typeof ReportRoutes.ListReportsRoute> = async (c) => {
        const page = Number(c.req.query("page") || 1);
        const limit = Number(c.req.query("limit") || 10);

        const { reports, total } = await this.reportService.listReports(page, limit);

        return c.json(reports, 200, {
            "X-Total-Count": total.toString(),
        });
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
