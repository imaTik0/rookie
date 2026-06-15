// deno-lint-ignore-file no-explicit-any
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

export function Delete(route: RouteConfig) {
    return function (target: any, propertyKey: string) {
        const routes = Reflect.getMetadata("routes", target.constructor) || [];
        routes.push({ method: "delete", route, handlerName: propertyKey });
        Reflect.defineMetadata("routes", routes, target.constructor);
    };
}

export function Patch(route: RouteConfig) {
    return function (target: any, propertyKey: string) {
        const routes = Reflect.getMetadata("routes", target.constructor) || [];
        routes.push({ method: "patch", route, handlerName: propertyKey });
        Reflect.defineMetadata("routes", routes, target.constructor);
    };
}

export function Put(route: RouteConfig) {
    return function (target: any, propertyKey: string) {
        const routes = Reflect.getMetadata("routes", target.constructor) || [];
        routes.push({ method: "put", route, handlerName: propertyKey });
        Reflect.defineMetadata("routes", routes, target.constructor);
    };
}

export function registerController(
    app: OpenAPIHono,
    controllerInstance: any,
    logger: Logger,
) {
    const prefix = Reflect.getMetadata("prefix", controllerInstance.constructor) || "";
    const routes = Reflect.getMetadata("routes", controllerInstance.constructor) || [];

    for (const { route, handlerName } of routes) {
        const handler = controllerInstance[handlerName].bind(
            controllerInstance,
        );
        app.openapi(route, async (c: any) => {
            return await handler(c);
        });
    }

    logger.log(
        `Registered controller: ${prefix} (${routes.length} route${
            routes.length === 1 ? "" : "s"
        })`,
    );
}
