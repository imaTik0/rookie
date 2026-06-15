import { createRoute } from "@hono/zod-openapi";
import {
    JobIdParam,
    JobListQuerySchema,
    JobSchema,
    PaginatedJobsResponseSchema,
} from "./JobSchema.ts";
import { ErrorSchema } from "../CommonSchema.ts";

const ListJobsRoute = createRoute({
    method: "get",
    path: "/jobs",
    tags: ["Jobs"],
    summary: "List async jobs (paginated, filterable)",
    description: `Returns a paginated list of async jobs, most recent first. Jobs are long-running \
operations submitted via other endpoints (e.g. \`POST /projects/from-url\`, \
\`POST /testsuites/{id}/execute\`). Filter with \`kind\` and \`status\` to find, for example, all \
currently \`RUNNING\` crawls.`,
    request: {
        query: JobListQuerySchema,
    },
    responses: {
        200: {
            description: "A paginated list of jobs.",
            content: { "application/json": { schema: PaginatedJobsResponseSchema } },
        },
    },
});

const GetJobRoute = createRoute({
    method: "get",
    path: "/jobs/{jobId}",
    tags: ["Jobs"],
    summary: "Get a job by ID (poll for status & result)",
    description:
        `Returns the current state of a job. Poll this endpoint to track progress: \`status\` \
moves \`PENDING\` → \`RUNNING\` → terminal (\`SUCCEEDED\` / \`FAILED\` / \`CANCELLED\`). On success \
\`result\` carries the output (e.g. \`{ reportId }\` or \`{ projectId }\`); on failure \`error\` \
explains why; \`progress\` holds the latest human-readable message.`,
    request: {
        params: JobIdParam,
    },
    responses: {
        200: {
            description: "The current job state.",
            content: { "application/json": { schema: JobSchema } },
        },
        404: {
            description: "No job exists with the given ID.",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

const CancelJobRoute = createRoute({
    method: "delete",
    path: "/jobs/{jobId}",
    tags: ["Jobs"],
    summary: "Request cancellation of a running job",
    description:
        `Requests cooperative cancellation of a job. The running operation stops at its next \
checkpoint (between execution steps or crawl batches) and transitions to \`CANCELLED\` — an \
in-flight Docker container or model call is allowed to finish rather than being force-killed. \
Already-finished jobs cannot be cancelled (\`409\`). Returns \`202 Accepted\`: confirm the final \
state by polling \`GET /jobs/{jobId}\`.`,
    request: {
        params: JobIdParam,
    },
    responses: {
        202: {
            description: "Cancellation requested; poll the job for the terminal status.",
            content: { "application/json": { schema: JobSchema } },
        },
        404: {
            description: "No job exists with the given ID.",
            content: { "application/json": { schema: ErrorSchema } },
        },
        409: {
            description: "The job has already finished and cannot be cancelled.",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

export const JobRoutes = {
    ListJobsRoute,
    GetJobRoute,
    CancelJobRoute,
};
