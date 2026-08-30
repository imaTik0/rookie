import { assert, assertEquals } from "@std/assert";
import { JobService } from "./JobService.ts";
import type { Executor } from "./Executor.ts";
import type { ProjectService } from "./ProjectService.ts";
import { JobCancelledError } from "../types/job.ts";
import type * as types from "../types/index.ts";
import { fakeLogger, inMemoryJobRepository, until } from "../testing/fakes.ts";

function svc(
    overrides: { executor?: Partial<Executor>; projectService?: Partial<ProjectService> } = {},
) {
    const repo = inMemoryJobRepository();
    const executor = (overrides.executor ?? {}) as Executor;
    const projectService = (overrides.projectService ?? {}) as ProjectService;
    const service = new JobService(repo, executor, projectService, fakeLogger());
    return { service, repo };
}

Deno.test("reconcileOnStartup fails jobs left RUNNING by a dead process", async () => {
    const { service, repo } = svc();
    const running = await repo.create("EXECUTE_TEST_SUITE", {});
    running.status = "RUNNING";
    await service.reconcileOnStartup();
    assertEquals(repo.store.get(running._id)!.status, "FAILED");
});

Deno.test("enqueue runs EXECUTE_TEST_SUITE to SUCCEEDED with the report result", async () => {
    const { service, repo } = svc({
        executor: {
            executeTestSuite: () => Promise.resolve({ _id: "rep-1", status: "SUCCESS" } as never),
        },
    });
    const job = await service.enqueue("EXECUTE_TEST_SUITE", { testSuiteId: "ts-1" });
    await until(() => repo.store.get(job._id)!.status === "SUCCEEDED");
    const done = repo.store.get(job._id)!;
    assertEquals(done.result, { reportId: "rep-1", status: "SUCCESS" });
});

Deno.test("a job whose executor returns null transitions to FAILED", async () => {
    const { service, repo } = svc({
        executor: { executeTestSuite: () => Promise.resolve(null as never) },
    });
    const job = await service.enqueue("EXECUTE_TEST_SUITE", { testSuiteId: "missing" });
    await until(() => repo.store.get(job._id)!.status === "FAILED");
    assert(repo.store.get(job._id)!.error?.includes("not found"));
});

Deno.test("requestCancel aborts a running job's signal -> CANCELLED", async () => {
    const { service, repo } = svc({
        executor: {
            executeTestSuite: (_id, _onProgress, signal?: AbortSignal) =>
                new Promise((_resolve, reject) => {
                    signal?.addEventListener("abort", () => reject(new JobCancelledError()));
                }) as never,
        },
    });
    const job = await service.enqueue("EXECUTE_TEST_SUITE", { testSuiteId: "ts" });
    await until(() => repo.store.get(job._id)!.status === "RUNNING");

    const outcome = await service.requestCancel(job._id);
    assertEquals(outcome, { found: true, cancelled: true });
    await until(() => repo.store.get(job._id)!.status === "CANCELLED");
});

Deno.test("requestCancel reports not-found for unknown jobs", async () => {
    const { service } = svc();
    assertEquals(await service.requestCancel("nope" as types.job.JobId), {
        found: false,
        cancelled: false,
    });
});

Deno.test("requestCancel on a terminal job does not cancel", async () => {
    const { service, repo } = svc();
    const job = await repo.create("EXECUTE_TEST_SUITE", {});
    job.status = "SUCCEEDED";
    assertEquals(await service.requestCancel(job._id), { found: true, cancelled: false });
});
