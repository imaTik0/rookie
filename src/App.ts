import { Logger } from "./Logger.ts";
import { OpenAPIHono } from "@hono/zod-openapi";
import { registerControllers } from "./api/registerControllers.ts";
import { Scalar } from "@scalar/hono-api-reference";
import { ConfigService } from "./service/ConfigService.ts";
import { Container } from "./Container.ts";
import { JobService } from "./service/JobService.ts";

import { logger } from "hono/logger";
import { cors } from "hono/cors";

// NOTE: intentionally NOT @Injectable — App ↔ Container is a circular import, and
// emitDecoratorMetadata would reference Container as a value at decoration time
// (temporal dead zone). App resolves fine via the name-based fallback.
export class App {
    private honoServer?: OpenAPIHono;

    constructor(
        private logger: Logger,
        private configService: ConfigService,
        private container: Container,
    ) {}

    init() {
        this.honoServer = new OpenAPIHono();
        this.honoServer.use("/*", cors());
        this.honoServer.use(logger((...args) => this.logger.log(...args)));

        registerControllers(this.honoServer, this.container, this.logger);

        // Fail any jobs left RUNNING by a previous process (their in-memory
        // runners did not survive the restart).
        void this.container.resolve<JobService>("jobService").reconcileOnStartup();

        this.honoServer.doc("/docs", {
            openapi: "3.0.0",
            info: {
                title: "Rookie API",
                version: "1.0.0",
            },
        });
        this.honoServer.get(
            "/",
            Scalar({
                url: "/docs",
                layout: "modern",
                theme: "solarized",
            }),
        );

        const port = this.configService.values.port;
        const hostname = this.configService.values.host;

        Deno.serve({
            port: port,
            hostname: hostname,
            onListen: () => {
                this.logger.log(`Listening on http://${hostname}:${port}/`);
            },
        }, this.honoServer.fetch);
    }
}
