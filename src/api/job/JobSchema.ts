import { z } from "@hono/zod-openapi";
import { PaginationQuerySchema, paginated } from "../CommonSchema.ts";

export const JobKindSchema = z.enum(["EXECUTE_TEST_SUITE", "CRAWL_DOCS"])
    .openapi({ example: "CRAWL_DOCS", description: "The kind of work the job performs." });

export const JobStatusSchema = z.enum([
    "PENDING",
    "RUNNING",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
]).openapi({ example: "RUNNING", description: "Current lifecycle status of the job." });

export const JobSchema = z
    .object({
        id: z.string().openapi({ example: "job_clx123abc", description: "Unique job identifier." }),
        kind: JobKindSchema,
        status: JobStatusSchema,
        params: z.record(z.string(), z.any()).openapi({
            description: "Input parameters the job was submitted with (kind-specific).",
        }),
        result: z.record(z.string(), z.any()).optional().openapi({
            description: "Result payload on success, e.g. `{ reportId }` or `{ projectId }`.",
            example: { projectId: "proj_clx123abc" },
        }),
        error: z.string().optional().openapi({
            description: "Error message when the job failed.",
        }),
        progress: z.string().optional().openapi({
            description: "Latest human-readable progress message.",
        }),
        createdAt: z.string().datetime().openapi({ example: "2025-10-27T10:00:00.000Z" }),
        startedAt: z.string().datetime().optional(),
        finishedAt: z.string().datetime().optional(),
    })
    .openapi("Job");

export const JobIdParam = z.object({
    jobId: z.string().min(1, "Job ID is required").openapi({
        param: { name: "jobId", in: "path" },
        example: "job_clx123abc",
        description: "Job ID",
    }),
});

export const JobListQuerySchema = PaginationQuerySchema.extend({
    kind: JobKindSchema.optional().openapi({
        param: { name: "kind", in: "query" },
        description: "Filter by job kind.",
    }),
    status: JobStatusSchema.optional().openapi({
        param: { name: "status", in: "query" },
        description: "Filter by job status.",
    }),
});

export const PaginatedJobsResponseSchema = paginated(JobSchema).openapi("PaginatedJobs");

export type JobSchema = z.infer<typeof JobSchema>;
export type JobIdParam = z.infer<typeof JobIdParam>;
export type JobListQuerySchema = z.infer<typeof JobListQuerySchema>;
