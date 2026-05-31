import { createRoute, z } from "@hono/zod-openapi";
import { ErrorSchema } from "../CommonSchema.ts";

export const TraceIdParam = z.object({
    traceId: z.string().describe("The ID of the trace"),
});

export const TestSuiteIdParam = z.object({
    testSuiteId: z.string().describe("The ID of the test suite"),
});

const GetTracesByTestSuiteRoute = createRoute({
    method: "get",
    path: "/testsuites/{testSuiteId}/traces",
    tags: ["Traces"],
    summary: "Get all traces for a Test Suite",
    request: { params: TestSuiteIdParam },
    responses: {
        200: {
            description: "Success",
            content: {
                "application/json": {
                    schema: z.array(z.any()).describe("List of traces"),
                },
            },
        },
        404: {
            description: "Not Found",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

const GetTraceByIdRoute = createRoute({
    method: "get",
    path: "/traces/{traceId}",
    tags: ["Traces"],
    summary: "Get a specific trace by ID",
    request: { params: TraceIdParam },
    responses: {
        200: {
            description: "Success",
            content: {
                "application/json": {
                    schema: z.any().describe("Trace event data"),
                },
            },
        },
        404: {
            description: "Not Found",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

export const TraceRoutes = {
    GetTracesByTestSuiteRoute,
    GetTraceByIdRoute,
};
