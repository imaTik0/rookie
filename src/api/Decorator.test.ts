import "reflect-metadata";
import { assert, assertEquals } from "@std/assert";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { Controller, Get, Post, registerController } from "./Decorator.ts";
import { fakeLogger } from "../testing/fakes.ts";

const PingRoute = createRoute({
    method: "get",
    path: "/things/ping",
    responses: {
        200: {
            description: "ok",
            content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
        },
    },
});
const CreateRoute = createRoute({
    method: "post",
    path: "/things",
    responses: {
        201: {
            description: "created",
            content: { "application/json": { schema: z.object({ id: z.string() }) } },
        },
    },
});

@Controller("/things")
class ThingController {
    // deno-lint-ignore no-explicit-any
    ping = (c: any) => c.json({ ok: true });
    // deno-lint-ignore no-explicit-any
    create = (c: any) => c.json({ id: "1" });
}
Get(PingRoute)(ThingController.prototype, "ping");
Post(CreateRoute)(ThingController.prototype, "create");

Deno.test("@Controller stores the route prefix as metadata", () => {
    assertEquals(Reflect.getMetadata("prefix", ThingController), "/things");
});

Deno.test("@Get/@Post accumulate route metadata on the constructor", () => {
    const routes = Reflect.getMetadata("routes", ThingController) as Array<
        { method: string; handlerName: string }
    >;
    assertEquals(routes.length, 2);
    const byHandler = new Map(routes.map((r) => [r.handlerName, r.method]));
    assertEquals(byHandler.get("ping"), "get");
    assertEquals(byHandler.get("create"), "post");
});

Deno.test("registerController mounts every route on the app and binds the handler", async () => {
    const captured: { route: unknown; handler: (c: unknown) => unknown }[] = [];
    const fakeApp = {
        openapi: (route: unknown, handler: (c: unknown) => unknown) =>
            captured.push({ route, handler }),
    } as unknown as OpenAPIHono;

    registerController(fakeApp, new ThingController(), fakeLogger());

    assertEquals(captured.length, 2);
    // deno-lint-ignore no-explicit-any
    const fakeCtx = { json: (body: unknown) => body } as any;
    const results = await Promise.all(captured.map((c) => c.handler(fakeCtx)));
    assert(results.some((r) => JSON.stringify(r) === JSON.stringify({ ok: true })));
    assert(results.some((r) => JSON.stringify(r) === JSON.stringify({ id: "1" })));
});
