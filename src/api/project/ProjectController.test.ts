/**
 * Tests for ProjectController handler logic (status codes + error mapping),
 * driven through a fake Hono context with a faked ProjectService/JobService.
 * Run with: deno test src/api/project/ProjectController.test.ts
 */
import { assertEquals } from "@std/assert";
import { ProjectController } from "./ProjectController.ts";
import type { ProjectService } from "../../service/ProjectService.ts";
import type { JobService } from "../../service/JobService.ts";
import { fakeContext, type FakeResponse } from "../../testing/fakes.ts";

// Controllers' RouteHandler signature is strongly typed (expects (c, next) and a
// Hono TypedResponse). For direct invocation in tests we view them as loose
// single-arg handlers returning our FakeResponse.
type Handlers = Record<string, (c: unknown) => Promise<FakeResponse>>;

function controller(
    project: Partial<ProjectService> = {},
    job: Partial<JobService> = {},
): Handlers {
    return new ProjectController(
        project as ProjectService,
        job as JobService,
    ) as unknown as Handlers;
}

Deno.test("createProject returns 201 with the new project", async () => {
    const c = controller({
        createProject: () => Promise.resolve({ id: "p1", projectName: "Demo" } as never),
    });
    const res = await c.createProject(fakeContext({ json: { projectName: "Demo", fileIds: [] } }));
    assertEquals(res.status, 201);
    assertEquals((res.body as { id: string }).id, "p1");
});

Deno.test("createProject maps a null service result to 500", async () => {
    const c = controller({ createProject: () => Promise.resolve(null as never) });
    const res = await c.createProject(fakeContext({ json: { projectName: "Demo", fileIds: [] } }));
    assertEquals(res.status, 500);
});

Deno.test("createProject maps a thrown error to 400 with its message", async () => {
    const c = controller({ createProject: () => Promise.reject(new Error("unknown file id")) });
    const res = await c.createProject(
        fakeContext({ json: { projectName: "Demo", fileIds: ["x"] } }),
    );
    assertEquals(res.status, 400);
    assertEquals((res.body as { message: string }).message, "unknown file id");
});

Deno.test("getProject returns 200 when found, 404 when missing", async () => {
    const found = controller({ getProjectById: () => Promise.resolve({ id: "p1" } as never) });
    assertEquals((await found.getProject(fakeContext({ param: { id: "p1" } }))).status, 200);

    const missing = controller({ getProjectById: () => Promise.resolve(null as never) });
    assertEquals((await missing.getProject(fakeContext({ param: { id: "z" } }))).status, 404);
});

Deno.test("listProjects returns 200 with the paginated payload", async () => {
    const payload = { items: [], meta: { total: 0 } };
    const c = controller({ listProjects: () => Promise.resolve(payload as never) });
    const res = await c.listProjects(fakeContext({ query: { page: 1, limit: 10 } }));
    assertEquals(res.status, 200);
    assertEquals(res.body, payload);
});

Deno.test("deleteProject returns 200 on success, 404 when absent", async () => {
    const ok = controller({ deleteProject: () => Promise.resolve(true) });
    assertEquals((await ok.deleteProject(fakeContext({ param: { id: "p1" } }))).status, 200);

    const gone = controller({ deleteProject: () => Promise.resolve(false) });
    assertEquals((await gone.deleteProject(fakeContext({ param: { id: "p1" } }))).status, 404);
});

Deno.test("updateProject returns 404 when the project does not exist", async () => {
    const c = controller({ updateProject: () => Promise.resolve(null as never) });
    const res = await c.updateProject(
        fakeContext({ param: { id: "z" }, json: { projectName: "x" } }),
    );
    assertEquals(res.status, 404);
});

Deno.test("createProjectFromUrl enqueues a CRAWL_DOCS job and returns 202", async () => {
    let enqueuedKind = "";
    const c = controller({}, {
        enqueue: (kind: string) => {
            enqueuedKind = kind;
            return Promise.resolve(
                {
                    _id: "job-1",
                    kind,
                    status: "PENDING",
                    params: {},
                    createdAt: new Date(),
                } as never,
            );
        },
    });
    const res = await c.createProjectFromUrl(
        fakeContext({ json: { projectName: "D", url: "https://x", maxPages: 5 } }),
    );
    assertEquals(res.status, 202);
    assertEquals(enqueuedKind, "CRAWL_DOCS");
});
