/**
 * Wiring smoke test: builds the real IoC container (with dummy external
 * connections) and registers controllers exactly as App.init does, then asserts
 * every expected route — including /traces, which was historically left
 * unmounted — is actually present on the app.
 *
 * No handlers are invoked, so the dummy Mongo/Qdrant/OpenAI values are never used
 * for I/O; this verifies wiring only. Run with: deno test --allow-all src/api/smoke.test.ts
 */
import "reflect-metadata";
import { assert } from "@std/assert";
import { OpenAPIHono } from "@hono/zod-openapi";
import { Container } from "../Container.ts";
import { registerControllers } from "./registerControllers.ts";
import { fakeLogger } from "../testing/fakes.ts";

async function buildApp(): Promise<OpenAPIHono> {
    const container = new Container();
    await container.init();
    // Dummy external connections — only used if a handler runs (none do here).
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
    // Hono stores params as `:id`; OpenAPI uses `{id}`. Normalise to one form.
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
            "/traces/{traceId}", // regression guard: was previously never registered
            "/testsuites/{testSuiteId}/traces",
        ]
    ) {
        assert(paths.has(expected), `route not mounted: ${expected}`);
    }
});
