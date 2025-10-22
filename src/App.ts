import { Hono } from "hono";
import { PromptService } from "./service/PromptService.ts";
import { Logger } from "./Logger.ts";
import * as path from "@std/path";
import { Executor } from "./service/WorkerPool.ts";
import { VectorCollectionFactory } from "./db/vectordb/VectorCollectionFactory.ts";
import { EmbeddingService } from "./service/EmbeddingService.ts";
import { FileLoaderService } from "./service/FileLoaderService.ts";

export class App {
    private honoServer: Hono;

    constructor(
        private promptService: PromptService,
        private vectorCollectionFactory: VectorCollectionFactory,
        private embeddingService: EmbeddingService,
        private fileLoaderService: FileLoaderService,
        private logger: Logger,
    ) {
        this.honoServer = new Hono();
    }

    async init() {
        const startContext = {
            bridgeUrl: "http://localhost:9111",
            apiKeyId: "299d4b404290730ffe47741fcaea8d1f",
            apiKeySecret: "d68bf10bb5897283d82c5b53d97af786",
            firstSolutionId: "c79f5ab1-ba94-4bb5-b1f1-caa8e7b84f99",
            firstContextId: "2e6f5546-63f1-4dd8-9eae-bae29977e0eb",
        };
        const vectorCollection = await this.vectorCollectionFactory
            .createCollection("pmx_bridge_docs");
        const filesContent = await this.fileLoaderService.readTextileFiles(
            path.resolve(Deno.cwd(), "../samples/bridge_slate_docs"),
        );
        // const res = JSON.parse(await Deno.readTextFile(path.resolve(Deno.cwd(), "../response.json")));
        const res = await this.promptService.promptForApiUsageScenario(
            filesContent.join("\n"),
            JSON.stringify(startContext),
        );
        await this.fileLoaderService.appendToFile(
            path.resolve(Deno.cwd(), "../response.json"),
            JSON.stringify(res, null, 2),
        );
        let id = 1;
        const workerPool = new Executor();
        let previousContext = startContext;
        for (const call of res.calls) {
            this.logger.log(id);
            const scriptPath = path.resolve(
                Deno.cwd(),
                `../code_to_execute_${id}.js`,
            );
            await this.fileLoaderService.appendToFile(scriptPath, call.fetch);
            const { _result, ctx } = await workerPool.executeScript(
                scriptPath,
                previousContext,
            );
            previousContext = ctx;
            const similarity = await vectorCollection.search(
                (await this.embeddingService.embed(call.stepExplanation))[0],
            );
            console.log(similarity);
            id++;
        }
        Deno.exit(1);
    }
}
