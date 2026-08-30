import { assertEquals } from "@std/assert";
import { TraceController } from "./TraceController.ts";
import type { TraceRepository } from "../../db/mongo/TraceRepository.ts";
import { fakeContext, type FakeResponse } from "../../testing/fakes.ts";

type Handlers = Record<string, (c: unknown) => Promise<FakeResponse>>;

function controller(repo: Partial<TraceRepository>): Handlers {
    return new TraceController(repo as TraceRepository) as unknown as Handlers;
}

Deno.test("getTracesByTestSuite returns the repository's traces with 200", async () => {
    const traces = [{ _id: "t1" }, { _id: "t2" }];
    const c = controller({ getByTestSuiteId: () => Promise.resolve(traces as never) });
    const res = await c.getTracesByTestSuite(fakeContext({ param: { testSuiteId: "ts-1" } }));
    assertEquals(res.status, 200);
    assertEquals((res.body as unknown[]).length, 2);
});

Deno.test("getTraceById returns 200 when found", async () => {
    const c = controller({ getById: () => Promise.resolve({ _id: "t1" } as never) });
    const res = await c.getTraceById(fakeContext({ param: { traceId: "t1" } }));
    assertEquals(res.status, 200);
});

Deno.test("getTraceById returns 404 when missing", async () => {
    const c = controller({ getById: () => Promise.resolve(null as never) });
    const res = await c.getTraceById(fakeContext({ param: { traceId: "nope" } }));
    assertEquals(res.status, 404);
});
