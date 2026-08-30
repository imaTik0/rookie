import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Container } from "../Container.ts";
import type { Logger } from "../Logger.ts";
import { registerController } from "./Decorator.ts";

export const CONTROLLER_NAMES = [
    "projectController",
    "fileController",
    "reportController",
    "testSuiteController",
    "plannerController",
    "jobController",
    "traceController",
] as const;

export function registerControllers(
    server: OpenAPIHono,
    container: Container,
    logger: Logger,
): void {
    for (const name of CONTROLLER_NAMES) {
        registerController(server, container.resolve(name), logger);
    }
}
