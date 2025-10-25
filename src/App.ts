import { Hono } from "hono";
import { PromptService } from "./service/PromptService.ts";
import { Logger } from "./Logger.ts";
import * as path from "@std/path";
import { Executor } from "./service/WorkerPool.ts";
import { VectorCollectionFactory } from "./db/vectordb/VectorCollectionFactory.ts";
import { EmbeddingService } from "./service/EmbeddingService.ts";
import { FileLoaderService } from "./service/FileLoaderService.ts";
import { OpenAPIHono } from "@hono/zod-openapi";
import { registerController } from "./api/Decorator.ts";
import { UserController } from "./api/user/UserController.ts";
import { Scalar } from "@scalar/hono-api-reference";
import { ConfigService } from "./service/ConfigService.ts";

export class App {
    private honoServer?: OpenAPIHono;

    constructor(
        private logger: Logger,
        private configService: ConfigService,
    ) {}

    init() {
        this.honoServer = new OpenAPIHono();

        registerController(this.honoServer, UserController, this.logger);

        this.honoServer.doc("/docs", {
            openapi: "3.0.0",
            info: {
                title: "Users API",
                version: "1.0.0",
            },
        });

        this.honoServer.get(
            "/",
            Scalar({
                url: "/docs",
                layout: "modern", // options: 'modern' | 'classic' | 'minimal'
                theme: "default", // or 'dark'
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
