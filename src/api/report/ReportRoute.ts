import { createRoute } from "@hono/zod-openapi";
import {
    PaginatedReportListSchema,
    ReportIdParam,
    ReportListQuerySchema,
    ReportSchema,
} from "./ReportSchema.ts";
import { ErrorSchema } from "../CommonSchema.ts";

export const ListReportsRoute = createRoute({
    method: "get",
    path: "/reports",
    tags: ["Reports"],
    summary: "List reports (slim, paginated, filterable)",
    description:
        `Returns a paginated list of execution reports in a **slim** form — id, type \
(\`TEST_SCENARIO\`, \`CODE_GENERATION\`, or \`MASTER_PLAN\`), status, timestamps, and master-plan \
linkage — without the heavy per-step detail. Fetch a single report by ID for the full payload.

Filter with \`projectId\`, \`testSuiteId\`, \`status\`, and \`type\` — e.g. \
\`GET /reports?projectId=…&status=FAILED\` to find a project's failed runs. Results come back in \
the standard \`{ items, meta }\` envelope.`,
    request: {
        query: ReportListQuerySchema,
    },
    responses: {
        200: {
            description: "A paginated list of slim reports.",
            content: { "application/json": { schema: PaginatedReportListSchema } },
        },
    },
});

export const GetReportRoute = createRoute({
    method: "get",
    path: "/reports/{reportId}",
    tags: ["Reports"],
    summary: "Get a single report by ID",
    description:
        `Returns the full report: the executed plan, every step (generated code, captured \
STDOUT/STDERR, status, and — for failures — the semantic classification and the related \
documentation fragments), overall status and duration. For a \`MASTER_PLAN\` report this also \
includes the generated goals, the structured summary, and links to the per-goal child reports.`,
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
    path: "/reports/{reportId}",
    tags: ["Reports"],
    summary: "Delete a report",
    description:
        `Permanently deletes a single report. Deleting a \`MASTER_PLAN\` report does not cascade \
to its per-goal child reports — remove those individually if needed. Returns \`204 No Content\` \
on success.`,
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
