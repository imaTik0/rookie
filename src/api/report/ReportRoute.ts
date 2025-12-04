import { createRoute } from "@hono/zod-openapi";
import { ListReportSchema, ReportIdParam, ReportSchema } from "./ReportSchema.ts";
import { ErrorSchema, PaginationQuerySchema } from "../CommonSchema.ts";

export const ListReportsRoute = createRoute({
    method: "get",
    path: "reports/",
    tags: ["Reports"],
    summary: "List all reports (slim version)",
    request: {
        query: PaginationQuerySchema,
    },
    responses: {
        200: {
            description: "A paginated list of slim reports",
            content: { "application/json": { schema: ListReportSchema } },
        },
    },
});

export const GetReportRoute = createRoute({
    method: "get",
    path: "reports/{reportId}",
    tags: ["Reports"],
    summary: "Get a single report by ID",
    request: {
        params: ReportIdParam,
    },
    responses: {
        200: {
            description: "Full Report details",
            content: { "application/json": { schema: ReportSchema } },
        },
        404: {
            description: "Report not found",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

export const DeleteReportRoute = createRoute({
    method: "delete",
    path: "reports/{reportId}",
    tags: ["Reports"],
    summary: "Delete a report",
    request: {
        params: ReportIdParam,
    },
    responses: {
        204: {
            description: "Report deleted successfully",
        },
        404: {
            description: "Report not found",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

export const ReportRoutes = {
    ListReportsRoute,
    GetReportRoute,
    DeleteReportRoute,
};
