import type { JobSchema as JobApi } from "./JobSchema.ts";
import * as db from "../../db/mongo/Model.ts";

export function mapJobToApi(job: db.JobModel): JobApi {
    return {
        id: job._id,
        kind: job.kind,
        status: job.status,
        params: job.params,
        result: job.result,
        error: job.error,
        progress: job.progress,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString(),
        finishedAt: job.finishedAt?.toISOString(),
    };
}
