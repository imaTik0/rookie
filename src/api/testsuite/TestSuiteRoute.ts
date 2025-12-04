// TestSuiteRoute.ts
import { createRoute } from "@hono/zod-openapi";
import {
    CreateTestSuiteSchema,
    TestSuiteIdParam,
    TestSuiteSchema,
    UpdateTestSuiteSchema,
} from "./TestSuiteSchema.ts";
import { ListReportSchema } from "../report/ReportSchema.ts";
import { z } from "@hono/zod-openapi";
import { ErrorSchema, PaginationQuerySchema } from "../CommonSchema.ts";

const commonResponses = {
    200: {
        description: "Success",
        content: { "application/json": { schema: TestSuiteSchema } },
    },
    404: {
        description: "Not Found",
        content: { "application/json": { schema: ErrorSchema } },
    },
    400: {
        description: "Invalid Request",
        content: { "application/json": { schema: ErrorSchema } },
    },
};

const CreateTestSuiteRoute = createRoute({
    method: "post",
    path: "/testsuites",
    tags: ["Test suites"],
    summary: "Create a new Test Suite",
    request: {
        body: {
            content: { "application/json": { schema: CreateTestSuiteSchema } },
            required: true,
        },
    },
    responses: {
        201: {
            description: "Test Suite created",
            content: { "application/json": { schema: TestSuiteSchema } },
        },
        400: commonResponses["400"],
    },
});

const ListTestSuitesRoute = createRoute({
    method: "get",
    tags: ["Test suites"],
    path: "/testsuites",
    summary: "List all Test Suites (paginated)",
    request: {
        query: PaginationQuerySchema,
    },
    responses: {
        200: {
            description: "A paginated list of Test Suites",
            content: {
                "application/json": {
                    schema: z.object({
                        testSuites: z.array(TestSuiteSchema),
                        total: z.number().int().describe("Total number of test suites"),
                    }),
                },
            },
        },
    },
});

const GetTestSuiteRoute = createRoute({
    method: "get",
    path: "/testsuites/{testSuiteId}",
    tags: ["Test suites"],
    summary: "Get a single Test Suite by ID",
    request: { params: TestSuiteIdParam },
    responses: {
        200: commonResponses["200"],
        404: commonResponses["404"],
    },
});

const UpdateTestSuiteRoute = createRoute({
    method: "patch", // Changed to PATCH for partial updates, matching example
    path: "/testsuites/{testSuiteId}",
    tags: ["Test suites"],
    summary: "Update a Test Suite",
    request: {
        params: TestSuiteIdParam,
        body: {
            content: { "application/json": { schema: UpdateTestSuiteSchema } },
            required: true,
        },
    },
    responses: {
        200: commonResponses["200"],
        400: commonResponses["400"],
        404: commonResponses["404"],
    },
});

const DeleteTestSuiteRoute = createRoute({
    method: "delete",
    path: "/testsuites/{testSuiteId}",
    tags: ["Test suites"],
    summary: "Delete a Test Suite",
    request: { params: TestSuiteIdParam },
    responses: {
        204: { description: "Test Suite deleted successfully" }, // 204 has no body
        404: commonResponses["404"],
    },
});

const ExecuteTestSuiteRoute = createRoute({
    method: "post",
    path: "/testsuites/{testSuiteId}/execute",
    tags: ["Test suites"],
    summary: "Execute a Test Suite",
    request: { params: TestSuiteIdParam },
    responses: {
        202: {
            description: "Execution accepted. Report creation initiated.",
            content: { "application/json": { schema: ListReportSchema } }, // Assuming ListReportSchema is correct per your import
        },
        404: commonResponses["404"],
    },
});

export const TestSuiteRoutes = {
    CreateTestSuiteRoute,
    ListTestSuitesRoute,
    GetTestSuiteRoute,
    UpdateTestSuiteRoute,
    DeleteTestSuiteRoute,
    ExecuteTestSuiteRoute,
};
