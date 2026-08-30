import { Injectable } from "../../ioc/decorator.ts";
import { MongoDbConnection } from "./MongoDbManager.ts";
import * as db from "./Model.ts";
import { BaseRepository } from "./BaseRepository.ts";
import * as types from "../../types/index.ts";

export interface JobFilter {
    kind?: types.job.JobKind;
    status?: types.job.JobStatus;
}

@Injectable()
export class JobRepository extends BaseRepository<types.job.JobId, db.JobModel> {
    static readonly COLLECTION_NAME = "jobs";

    constructor(mongoDbConnection: MongoDbConnection) {
        super(mongoDbConnection, JobRepository.COLLECTION_NAME);
    }

    async create(kind: types.job.JobKind, params: Record<string, unknown>): Promise<db.JobModel> {
        const job: db.JobModel = {
            _id: this.generateId(),
            kind,
            status: "PENDING",
            params,
            createdAt: new Date(),
        };
        await this.getCollection().insertOne(job);
        return job;
    }

    async get(jobId: types.job.JobId): Promise<db.JobModel | null> {
        return await this.getCollection().findOne({ _id: jobId });
    }

    async list(
        filter: JobFilter,
        pagination: { page: number; limit: number },
    ): Promise<{ items: db.JobModel[]; total: number }> {
        const { page, limit } = pagination;
        const skip = (page - 1) * limit;
        const query: Record<string, unknown> = {};
        if (filter.kind) query.kind = filter.kind;
        if (filter.status) query.status = filter.status;

        const collection = this.getCollection();
        const [items, total] = await Promise.all([
            collection.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
            collection.countDocuments(query),
        ]);
        return { items, total };
    }

    private async patch(
        jobId: types.job.JobId,
        set: Partial<db.JobModel>,
    ): Promise<db.JobModel | null> {
        const result = await this.getCollection().findOneAndUpdate(
            { _id: jobId },
            { $set: set },
            { returnDocument: "after" },
        );
        return result ?? null;
    }

    markRunning(jobId: types.job.JobId): Promise<db.JobModel | null> {
        return this.patch(jobId, { status: "RUNNING", startedAt: new Date() });
    }

    updateProgress(jobId: types.job.JobId, progress: string): Promise<db.JobModel | null> {
        return this.patch(jobId, { progress });
    }

    markSucceeded(
        jobId: types.job.JobId,
        result: Record<string, unknown>,
    ): Promise<db.JobModel | null> {
        return this.patch(jobId, { status: "SUCCEEDED", result, finishedAt: new Date() });
    }

    markFailed(jobId: types.job.JobId, error: string): Promise<db.JobModel | null> {
        return this.patch(jobId, { status: "FAILED", error, finishedAt: new Date() });
    }

    markCancelled(jobId: types.job.JobId): Promise<db.JobModel | null> {
        return this.patch(jobId, { status: "CANCELLED", finishedAt: new Date() });
    }

    async failAllRunning(reason: string): Promise<number> {
        const result = await this.getCollection().updateMany(
            { status: { $in: ["RUNNING", "PENDING"] } },
            { $set: { status: "FAILED", error: reason, finishedAt: new Date() } },
        );
        return result.modifiedCount ?? 0;
    }
}
