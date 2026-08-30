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
    description:
        `Returns the low-level execution traces recorded for a test suite's runs — the raw, \
ordered event log behind the agentic pipeline (\`LLM_CALL\` events with prompts/responses and \
token usage, \`TOOL_CALL\` events with tool name, arguments, and results), tagged by phase \
(Research / Verification / Generation). Intended for debugging and observability; the Reports \
API is the user-facing summary of a run.`,
    request: { params: TestSuiteIdParam },
    responses: {
        200: {
            description: "Ordered list of trace events for the test suite's executions.",
            content: {
                "application/json": {
                    schema: z.array(z.any()).describe("List of traces"),
                },
            },
        },
        404: {
            description: "No test suite exists with the given ID.",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

const GetTraceByIdRoute = createRoute({
    method: "get",
    path: "/traces/{traceId}",
    tags: ["Traces"],
    summary: "Get a specific trace by ID",
    description: `Returns a single trace document by ID, including its full ordered list of events \
(\`LLM_CALL\` / \`TOOL_CALL\`) and the phase/goal metadata it was recorded under.`,
    request: { params: TraceIdParam },
    responses: {
        200: {
            description: "The trace document with its full event list.",
            content: {
                "application/json": {
                    schema: z.any().describe("Trace event data"),
                },
            },
        },
        404: {
            description: "No trace exists with the given ID.",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

export const TraceRoutes = {
    GetTracesByTestSuiteRoute,
    GetTraceByIdRoute,
};
