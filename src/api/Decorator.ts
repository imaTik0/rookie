// deno-lint-ignore-file no-explicit-any
// src/api/Decorator.ts
import "reflect-metadata";
import { OpenAPIHono, RouteConfig } from "@hono/zod-openapi";
import { Logger } from "../Logger.ts";

export function Controller(prefix: string = "") {
    return function (target: any) {
        Reflect.defineMetadata("prefix", prefix, target);
    };
}

export function Get(route: RouteConfig) {
    return function (target: any, propertyKey: string) {
        const routes = Reflect.getMetadata("routes", target.constructor) || [];
        routes.push({ method: "get", route, handlerName: propertyKey });
        Reflect.defineMetadata("routes", routes, target.constructor);
    };
}

export function Post(route: RouteConfig) {
    return function (target: any, propertyKey: string) {
        const routes = Reflect.getMetadata("routes", target.constructor) || [];
        routes.push({ method: "post", route, handlerName: propertyKey });
        Reflect.defineMetadata("routes", routes, target.constructor);
    };
}

export function registerController(
    app: OpenAPIHono,
    ControllerClass: any,
    logger?: Logger,
) {
    const instance = new ControllerClass();
    const prefix = Reflect.getMetadata("prefix", ControllerClass) || "";
    const routes = Reflect.getMetadata("routes", ControllerClass) || [];

    for (const { _method, route, handlerName } of routes) {
        // Ensure handler is bound correctly to instance
        const handler = instance[handlerName].bind(instance);

        // Register the OpenAPI route dynamically
        app.openapi(route, async (c: any) => {
            // Allow handler to use 'this'
            return await handler(c);
        });
    }

    if (logger) {
        logger.log(
            `✅ Registered controller: ${prefix} (${routes.length} route${
                routes.length === 1 ? "" : "s"
            })`,
        );
    }
}
