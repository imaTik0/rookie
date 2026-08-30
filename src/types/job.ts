export type JobId = string & { __jobId: never };

export type JobKind = "EXECUTE_TEST_SUITE" | "CRAWL_DOCS";

export type JobStatus =
    | "PENDING"
    | "RUNNING"
    | "SUCCEEDED"
    | "FAILED"
    | "CANCELLED";

export const TERMINAL_STATUSES: readonly JobStatus[] = ["SUCCEEDED", "FAILED", "CANCELLED"];

export function isTerminal(status: JobStatus): boolean {
    return TERMINAL_STATUSES.includes(status);
}

export interface Job {
    id: JobId;
    kind: JobKind;
    status: JobStatus;
    params: Record<string, unknown>;
    result?: Record<string, unknown>;
    error?: string;
    progress?: string;
    createdAt: Date;
    startedAt?: Date;
    finishedAt?: Date;
}

export class JobCancelledError extends Error {
    constructor(message = "Job cancelled") {
        super(message);
        this.name = "JobCancelledError";
    }
}
