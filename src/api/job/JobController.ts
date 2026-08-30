import type { RouteHandler } from "@hono/zod-openapi";
import { Controller, Delete, Get } from "../Decorator.ts";
import { JobService } from "../../service/JobService.ts";
import { JobRoutes } from "./JobRoute.ts";
import { mapJobToApi } from "./JobMapper.ts";
import { buildMeta } from "../CommonSchema.ts";
import * as types from "../../types/index.ts";

@Controller()
export class JobController {
    constructor(
        private jobService: JobService,
    ) {}

    @Get(JobRoutes.ListJobsRoute)
    listJobs: RouteHandler<typeof JobRoutes.ListJobsRoute> = async (c) => {
        const { page, limit, kind, status } = c.req.valid("query");
        const { items, total } = await this.jobService.list({ kind, status }, { page, limit });
        return c.json({
            items: items.map(mapJobToApi),
            meta: buildMeta(total, page, limit),
        }, 200);
    };

    @Get(JobRoutes.GetJobRoute)
    getJob: RouteHandler<typeof JobRoutes.GetJobRoute> = async (c) => {
        const { jobId } = c.req.valid("param");
        const job = await this.jobService.get(jobId as types.job.JobId);
        if (!job) {
            return c.json({ code: 404, message: "Job not found" }, 404);
        }
        return c.json(mapJobToApi(job), 200);
    };

    @Delete(JobRoutes.CancelJobRoute)
    cancelJob: RouteHandler<typeof JobRoutes.CancelJobRoute> = async (c) => {
        const { jobId } = c.req.valid("param");
        const outcome = await this.jobService.requestCancel(jobId as types.job.JobId);
        if (!outcome.found) {
            return c.json({ code: 404, message: "Job not found" }, 404);
        }
        if (!outcome.cancelled) {
            return c.json({ code: 409, message: "Job has already finished" }, 409);
        }
        const job = await this.jobService.get(jobId as types.job.JobId);
        return c.json(mapJobToApi(job!), 202);
    };
}
