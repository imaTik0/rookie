/**
 * Async job domain — long-running operations (test-suite execution, doc crawling)
 * are submitted as jobs, polled for status, and can be cancelled.
 */

export type JobId = string & { __jobId: never };

export type JobKind = "EXECUTE_TEST_SUITE" | "CRAWL_DOCS";

export type JobStatus =
    | "PENDING"
    | "RUNNING"
    | "SUCCEEDED"
    | "FAILED"
    | "CANCELLED";

/** Statuses after which a job no longer changes. */
export const TERMINAL_STATUSES: readonly JobStatus[] = ["SUCCEEDED", "FAILED", "CANCELLED"];

export function isTerminal(status: JobStatus): boolean {
    return TERMINAL_STATUSES.includes(status);
}

export interface Job {
    id: JobId;
    kind: JobKind;
    status: JobStatus;
    /** Input parameters the job was submitted with (kind-specific). */
    params: Record<string, unknown>;
    /** Result payload on success (e.g. `{ reportId }` or `{ projectId }`). */
    result?: Record<string, unknown>;
    /** Error message when the job failed. */
    error?: string;
    /** Last human-readable progress message emitted during execution. */
    progress?: string;
    createdAt: Date;
    startedAt?: Date;
    finishedAt?: Date;
}

/** Thrown by cancellable operations when their AbortSignal fires. */
export class JobCancelledError extends Error {
    constructor(message = "Job cancelled") {
        super(message);
        this.name = "JobCancelledError";
    }
}
