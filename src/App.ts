import { Logger } from "./Logger.ts";
import { OpenAPIHono } from "@hono/zod-openapi";
import { registerController } from "./api/Decorator.ts";
import { ProjectController } from "./api/project/ProjectController.ts";
import { Scalar } from "@scalar/hono-api-reference";
import { ConfigService } from "./service/ConfigService.ts";
import { Container } from "./Container.ts";
import { FileController } from "./api/file/FileController.ts";

export class App {
    private honoServer?: OpenAPIHono;

    constructor(
        private logger: Logger,
        private configService: ConfigService,
        private container: Container,
    ) {}

    init() {
        this.honoServer = new OpenAPIHono();
        registerController(
            this.honoServer,
            this.container.resolve<ProjectController>("projectController"),
            this.logger,
        );
        registerController(
            this.honoServer,
            this.container.resolve<FileController>("fileController"),
            this.logger,
        );
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
