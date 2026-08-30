import "reflect-metadata";
import { assert } from "@std/assert";
import { OpenAPIHono } from "@hono/zod-openapi";
import { Container } from "../Container.ts";
import { registerControllers } from "./registerControllers.ts";
import { fakeLogger } from "../testing/fakes.ts";

async function buildApp(): Promise<OpenAPIHono> {
    const container = new Container();
    await container.init();
    container.registerMongoConnection({ getCollection: () => ({}), getDb: () => ({}) } as never);
    container.registerVectorConnection({} as never);
    container.registerOpenAIFetcher({} as never);
    container.registerOpenAIEmbeddingFetcher({} as never);

    const app = new OpenAPIHono();
    registerControllers(app, container, fakeLogger());
    return app;
}

Deno.test("all controllers are mounted, including the trace routes", async () => {
    const app = await buildApp();
    const norm = (p: string) => p.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    const paths = new Set(app.routes.map((r) => norm(r.path)));

    for (
        const expected of [
            "/projects",
            "/projects/{id}",
            "/files/upload",
            "/reports",
            "/reports/{reportId}",
            "/testsuites",
            "/planner/run",
            "/jobs",
            "/traces/{traceId}",
            "/testsuites/{testSuiteId}/traces",
        ]
    ) {
        assert(paths.has(expected), `route not mounted: ${expected}`);
    }
});
