import { Injectable } from "../ioc/decorator.ts";
import { Logger } from "../Logger.ts";
import { JobFilter, JobRepository } from "../db/mongo/JobRepository.ts";
import { Executor } from "./Executor.ts";
import { ProjectService } from "./ProjectService.ts";
import * as db from "../db/mongo/Model.ts";
import * as types from "../types/index.ts";

export interface CancelOutcome {
    found: boolean;
    cancelled: boolean;
}

@Injectable()
export class JobService {
    private readonly running = new Map<types.job.JobId, AbortController>();
    private readonly lastProgressAt = new Map<types.job.JobId, number>();
    private static readonly PROGRESS_THROTTLE_MS = 1000;

    constructor(
        private jobRepository: JobRepository,
        private executor: Executor,
        private projectService: ProjectService,
        private logger: Logger,
    ) {}

    async reconcileOnStartup(): Promise<void> {
        const n = await this.jobRepository.failAllRunning("Interrupted by server restart");
        if (n > 0) this.logger.log(`Reconciled ${n} interrupted job(s) to FAILED on startup.`);
    }

    async enqueue(
        kind: types.job.JobKind,
        params: Record<string, unknown>,
    ): Promise<db.JobModel> {
        const job = await this.jobRepository.create(kind, params);
        const controller = new AbortController();
        this.running.set(job._id, controller);
        void this.run(job, controller.signal);
        return job;
    }

    get(jobId: types.job.JobId): Promise<db.JobModel | null> {
        return this.jobRepository.get(jobId);
    }

    list(
        filter: JobFilter,
        pagination: { page: number; limit: number },
    ): Promise<{ items: db.JobModel[]; total: number }> {
        return this.jobRepository.list(filter, pagination);
    }

    async requestCancel(jobId: types.job.JobId): Promise<CancelOutcome> {
        const job = await this.jobRepository.get(jobId);
        if (!job) return { found: false, cancelled: false };
        if (types.job.isTerminal(job.status)) return { found: true, cancelled: false };

        const controller = this.running.get(jobId);
        if (controller) {
            controller.abort();
            return { found: true, cancelled: true };
        }
        await this.jobRepository.markCancelled(jobId);
        return { found: true, cancelled: true };
    }

    private async run(job: db.JobModel, signal: AbortSignal): Promise<void> {
        await this.jobRepository.markRunning(job._id);
        const onProgress = (msg: string) => this.recordProgress(job._id, msg);
        try {
            const result = await this.dispatch(job, signal, onProgress);
            await this.jobRepository.markSucceeded(job._id, result);
        } catch (err) {
            if (signal.aborted) {
                await this.jobRepository.markCancelled(job._id);
                this.logger.log(`Job ${job._id} (${job.kind}) cancelled.`);
            } else {
                const message = (err as Error)?.message ?? String(err);
                await this.jobRepository.markFailed(job._id, message);
                this.logger.error(err, `Job ${job._id} (${job.kind}) failed: ${message}`);
            }
        } finally {
            this.running.delete(job._id);
            this.lastProgressAt.delete(job._id);
        }
    }

    private async dispatch(
        job: db.JobModel,
        signal: AbortSignal,
        onProgress: (msg: string) => void,
    ): Promise<Record<string, unknown>> {
        switch (job.kind) {
            case "EXECUTE_TEST_SUITE": {
                const testSuiteId = job.params.testSuiteId as types.test.TestSuiteId;
                const report = await this.executor.executeTestSuite(
                    testSuiteId,
                    onProgress,
                    signal,
                );
                if (!report) throw new Error("Test suite or its project was not found");
                return { reportId: report._id, status: report.status };
            }
            case "CRAWL_DOCS": {
                const project = await this.projectService.createProjectFromUrl(
                    job.params.projectName as string,
                    job.params.url as string,
                    job.params.maxPages as number | undefined,
                    onProgress,
                    signal,
                );
                if (!project) throw new Error("Project creation returned no result");
                return { projectId: project.id };
            }
        }
    }

    private recordProgress(jobId: types.job.JobId, msg: string): void {
        const now = Date.now();
        const last = this.lastProgressAt.get(jobId) ?? 0;
        if (now - last < JobService.PROGRESS_THROTTLE_MS) return;
        this.lastProgressAt.set(jobId, now);
        void this.jobRepository.updateProgress(jobId, msg.slice(0, 500)).catch(() => {});
    }
}
