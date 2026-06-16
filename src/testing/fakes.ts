/**
 * Shared test doubles. Pure, in-process — no infrastructure.
 *
 * Intentionally minimal: each fake implements only the surface the code under
 * test actually touches, cast to the real type so call sites stay honest.
 */
import type OpenAI from "@openai/openai";
import type { Logger } from "../Logger.ts";
import type { JobRepository } from "../db/mongo/JobRepository.ts";
import type { EmbeddingService } from "../service/EmbeddingService.ts";
import type * as db from "../db/mongo/Model.ts";
import type * as types from "../types/index.ts";

// ── Logger ───────────────────────────────────────────────────────────────────

/** A no-op Logger that records calls, so tests can assert on logging without spam. */
export function fakeLogger(): Logger & { calls: { level: string; args: unknown[] }[] } {
    const calls: { level: string; args: unknown[] }[] = [];
    const make = (level: string) => (...args: unknown[]) => calls.push({ level, args });
    return {
        name: "fake",
        calls,
        log: make("log"),
        warn: make("warn"),
        error: make("error"),
        debug: make("debug"),
    } as unknown as Logger & { calls: { level: string; args: unknown[] }[] };
}

// ── OpenAI chat client ─────────────────────────────────────────────────────────

/** One scripted reply: either return `content` or throw `error`. */
export type FakeChatStep = { content: string } | { error: unknown };

export interface FakeOpenAI {
    /** Cast to the real OpenAI type for injection. */
    openai: OpenAI;
    /** Every request body passed to chat.completions.create, in order. */
    calls: Record<string, unknown>[];
}

/**
 * Minimal OpenAI fake driving `chat.completions.create`. Steps are consumed in
 * order; a function lets a step depend on the call index / request body
 * (e.g. to throw a 400 the first time and succeed after a mode-downgrade).
 */
export function fakeOpenAI(
    steps: FakeChatStep[] | ((callIndex: number, body: Record<string, unknown>) => FakeChatStep),
): FakeOpenAI {
    const calls: Record<string, unknown>[] = [];
    let i = 0;
    const create = (body: Record<string, unknown>) => {
        calls.push(body);
        const step = typeof steps === "function"
            ? steps(i, body)
            : steps[Math.min(i, steps.length - 1)];
        i++;
        if ("error" in step) return Promise.reject(step.error);
        return Promise.resolve({ choices: [{ message: { content: step.content } }] });
    };
    const openai = { chat: { completions: { create } } } as unknown as OpenAI;
    return { openai, calls };
}

/** Build an OpenAI-style HTTP error (status + message), as the SDK surfaces it. */
export function apiError(status: number, message = "error"): Error & { status: number } {
    const e = new Error(message) as Error & { status: number };
    e.status = status;
    return e;
}

// ── EmbeddingService ─────────────────────────────────────────────────────────────

/**
 * Fake EmbeddingService. By default every text embeds to the same vector (so
 * cosine similarity is uniform and ordering is input-stable); pass `embedBatch`
 * to control scores.
 */
export function fakeEmbeddingService(
    embedBatch?: (texts: string[]) => number[][],
): EmbeddingService {
    const batch = embedBatch ?? ((texts: string[]) => texts.map(() => [1, 0, 0]));
    return {
        embed: (t: string) => Promise.resolve([batch([t])[0]]),
        embedBatch: (ts: string[]) => Promise.resolve(batch(ts)),
        sparseEmbed: () => ({ indices: [], values: [] }),
        sparseEmbedDocument: () => ({ indices: [], values: [] }),
    } as unknown as EmbeddingService;
}

// ── DockerExecutor ───────────────────────────────────────────────────────────────

export interface FakeExecResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    isTimeout?: boolean;
}

/**
 * Fake DockerExecutor: returns scripted results in order (last repeats).
 * Assign onto `(executor as any).dockerExecutor` to avoid real containers.
 */
export function fakeDockerExecutor(results: FakeExecResult[]) {
    let i = 0;
    const calls: { language: string; code: string }[] = [];
    return {
        calls,
        execute: (language: string, code: string) => {
            calls.push({ language, code });
            const r = results[Math.min(i, results.length - 1)] ??
                { exitCode: 0, stdout: "", stderr: "" };
            i++;
            return Promise.resolve({ isTimeout: false, ...r });
        },
    };
}

// ── JobRepository (in-memory) ───────────────────────────────────────────────────

/** In-memory JobRepository mirroring the Mongo one's status transitions. */
export function inMemoryJobRepository(): JobRepository & { store: Map<string, db.JobModel> } {
    const store = new Map<string, db.JobModel>();
    let seq = 0;
    const patch = (id: string, set: Partial<db.JobModel>) => {
        const job = store.get(id);
        if (!job) return Promise.resolve(null);
        Object.assign(job, set);
        return Promise.resolve(job);
    };
    const repo = {
        store,
        create(kind: types.job.JobKind, params: Record<string, unknown>) {
            const job = {
                _id: `job-${++seq}` as types.job.JobId,
                kind,
                status: "PENDING",
                params,
                createdAt: new Date(),
            } as db.JobModel;
            store.set(job._id, job);
            return Promise.resolve(job);
        },
        get: (id: types.job.JobId) => Promise.resolve(store.get(id) ?? null),
        list: () => Promise.resolve({ items: [...store.values()], total: store.size }),
        markRunning: (id: types.job.JobId) =>
            patch(id, { status: "RUNNING", startedAt: new Date() } as Partial<db.JobModel>),
        updateProgress: (id: types.job.JobId, progress: string) =>
            patch(id, { progress } as Partial<db.JobModel>),
        markSucceeded: (id: types.job.JobId, result: Record<string, unknown>) =>
            patch(
                id,
                { status: "SUCCEEDED", result, finishedAt: new Date() } as Partial<db.JobModel>,
            ),
        markFailed: (id: types.job.JobId, error: string) =>
            patch(id, { status: "FAILED", error, finishedAt: new Date() } as Partial<db.JobModel>),
        markCancelled: (id: types.job.JobId) =>
            patch(id, { status: "CANCELLED", finishedAt: new Date() } as Partial<db.JobModel>),
        failAllRunning(reason: string) {
            let n = 0;
            for (const job of store.values()) {
                if (job.status === "RUNNING" || job.status === "PENDING") {
                    Object.assign(job, { status: "FAILED", error: reason, finishedAt: new Date() });
                    n++;
                }
            }
            return Promise.resolve(n);
        },
    };
    return repo as unknown as JobRepository & { store: Map<string, db.JobModel> };
}

// ── Hono context ────────────────────────────────────────────────────────────────

export interface FakeResponse {
    body: unknown;
    status: number;
}

/**
 * Minimal Hono context for invoking a controller handler directly.
 * `valid` supplies what `c.req.valid("json"|"param"|"query")` returns; the
 * handler's `c.json/text/body` calls are echoed back as { body, status }.
 */
// deno-lint-ignore no-explicit-any
export function fakeContext(valid: { json?: unknown; param?: unknown; query?: unknown } = {}): any {
    const reply = (body: unknown, status = 200): FakeResponse => ({ body, status });
    return {
        req: {
            valid: (target: "json" | "param" | "query") =>
                (valid as Record<string, unknown>)[target],
        },
        json: reply,
        text: reply,
        body: reply,
    };
}

/** Poll `cond` until true or timeout (for awaiting fire-and-forget job runners). */
export async function until(cond: () => boolean, timeoutMs = 1000): Promise<void> {
    const start = Date.now();
    while (!cond()) {
        if (Date.now() - start > timeoutMs) throw new Error("until: condition not met in time");
        await new Promise((r) => setTimeout(r, 5));
    }
}
