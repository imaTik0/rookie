import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Container } from "../Container.ts";
import type { Logger } from "../Logger.ts";
import { registerController } from "./Decorator.ts";

/**
 * Single source of truth for which controllers the HTTP server mounts.
 *
 * App.init() and the wiring smoke test both register from this list, so a
 * controller can never be silently left unmounted (as TraceController once was).
 * Names match the IoC keys produced by the auto-scanner (camel-cased class names).
 */
export const CONTROLLER_NAMES = [
    "projectController",
    "fileController",
    "reportController",
    "testSuiteController",
    "plannerController",
    "jobController",
    "traceController",
] as const;

/** Resolve every controller from the container and mount its routes on the app. */
export function registerControllers(
    server: OpenAPIHono,
    container: Container,
    logger: Logger,
): void {
    for (const name of CONTROLLER_NAMES) {
        registerController(server, container.resolve(name), logger);
    }
}
