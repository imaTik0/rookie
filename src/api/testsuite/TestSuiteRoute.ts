import { createRoute } from "@hono/zod-openapi";
import {
    CreateTestSuiteSchema,
    TestSuiteIdParam,
    TestSuiteSchema,
    UpdateTestSuiteSchema,
} from "./TestSuiteSchema.ts";
import { JobSchema } from "../job/JobSchema.ts";
import { z } from "@hono/zod-openapi";
import { ErrorSchema, paginated, PaginationQuerySchema } from "../CommonSchema.ts";

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
    description: `Defines a reusable test against a project's documentation. A test suite is a \
**specification only** — it does not run until you call one of the \`/execute\` endpoints.

Pick a \`mode\`:
- **\`CODE_GENERATION\`** — the agent writes and runs a program that fulfils \`userGoal\` using \
only the documentation.
- **\`TEST_SCENARIO\`** — the agent produces a multi-step scenario (length bounded by \
\`minimalStoryLength\`..\`maximalStoryLength\`) from \`functionTemplate\`.

\`initialContext\` is a JSON **string** made available to the generated code (e.g. base URL and \
auth token). The suite must reference an existing \`projectId\` whose documentation is indexed.`,
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

const TestSuiteListQuerySchema = PaginationQuerySchema.extend({
    projectId: z.string().optional().openapi({
        param: { name: "projectId", in: "query" },
        description: "Filter test suites by the project they belong to.",
    }),
});

const ListTestSuitesRoute = createRoute({
    method: "get",
    tags: ["Test suites"],
    path: "/testsuites",
    summary: "List Test Suites (paginated, filterable)",
    description:
        `Returns a paginated list of test-suite definitions in the standard \`{ items, meta }\` \
envelope. Filter to a single project with \`?projectId=…\`.`,
    request: {
        query: TestSuiteListQuerySchema,
    },
    responses: {
        200: {
            description: "A paginated list of Test Suites.",
            content: { "application/json": { schema: paginated(TestSuiteSchema) } },
        },
    },
});

const GetTestSuiteRoute = createRoute({
    method: "get",
    path: "/testsuites/{testSuiteId}",
    tags: ["Test suites"],
    summary: "Get a single Test Suite by ID",
    description:
        "Returns one test-suite definition by ID. This is the spec, not its execution results — see the Reports API for run output.",
    request: { params: TestSuiteIdParam },
    responses: {
        200: commonResponses["200"],
        404: commonResponses["404"],
    },
});

const UpdateTestSuiteRoute = createRoute({
    method: "patch",
    path: "/testsuites/{testSuiteId}",
    tags: ["Test suites"],
    summary: "Update a Test Suite",
    description:
        `Partially updates a test-suite definition; omitted fields are unchanged. Affects future \
executions only — reports from previous runs are not modified.`,
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
    description:
        "Deletes a test-suite definition. Reports already produced by its past executions are retained. Returns `204 No Content`.",
    request: { params: TestSuiteIdParam },
    responses: {
        204: { description: "Test Suite deleted successfully" },
        404: commonResponses["404"],
    },
});

const ExecuteTestSuiteRoute = createRoute({
    method: "post",
    path: "/testsuites/{testSuiteId}/execute",
    tags: ["Test suites"],
    summary: "Execute a Test Suite (async job)",
    description:
        `Submits the test suite for execution and returns immediately with a **job**. The work \
runs in the background: the agent plans, writes code from the documentation, and executes it in \
an isolated, hardened Docker sandbox (real HTTP calls, no mocks), classifying any failure.

Poll \`GET /jobs/{jobId}\` for status; on \`SUCCEEDED\` the job's \`result.reportId\` points to the \
full report. Cancel mid-run with \`DELETE /jobs/{jobId}\`. For live log streaming instead of \
polling, use \`GET /testsuites/{id}/execute/stream\` (SSE).`,
    request: { params: TestSuiteIdParam },
    responses: {
        202: {
            description:
                "Execution accepted; returns the job to poll (`result.reportId` on success).",
            content: { "application/json": { schema: JobSchema } },
        },
        404: commonResponses["404"],
    },
});

const StreamExecuteTestSuiteRoute = createRoute({
    method: "get",
    path: "/testsuites/{testSuiteId}/execute/stream",
    tags: ["Test suites"],
    summary: "Execute a Test Suite and stream logs via SSE",
    description: `Same execution as \`POST .../execute\`, but streams live progress over \
**Server-Sent Events** so a UI can follow the agent in real time. Default \`message\` events \
carry human-readable progress logs (research queries, generated code, container STDOUT/STDERR); \
a terminal \`done\` event carries the final report as JSON, or an \`error\` event carries a \
message if the run fails. Consume with an \`EventSource\` client.`,
    request: { params: TestSuiteIdParam },
    responses: {
        200: {
            description:
                "An SSE stream of progress events ending in a `done` (report) or `error` event.",
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
    StreamExecuteTestSuiteRoute,
};
