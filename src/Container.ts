import * as path from "@std/path";
import { IOC } from "./ioc/IOC.ts";
import { Scanner } from "./ioc/Scanner.ts";
import { Logger } from "./Logger.ts";
import { App } from "./App.ts";
import { MongoDbConnection } from "./db/mongo/MongoDbManager.ts";
import { ConfigService } from "./service/ConfigService.ts";
import { MigrationManager } from "./db/mongo/MigrationManager.ts";
import { VectorConnection } from "./db/vectordb/VectorManger.ts";
import { VectorCollectionFactory } from "./db/vectordb/VectorCollectionFactory.ts";
import { EmbeddingService } from "./service/EmbeddingService.ts";
import OpenAI from "@openai/openai";
import { TraceRepository } from "./db/mongo/TraceRepository.ts";
import { ProjectRepository } from "./db/mongo/ProjectRepository.ts";
import { FileRepository } from "./db/mongo/FileRepository.ts";
import { JobRepository } from "./db/mongo/JobRepository.ts";
import { ReportRepository } from "./db/mongo/ReportRepository.ts";
import { TestSuiteRepository } from "./db/mongo/TestSuiteRepository.ts";

export class Container extends IOC {
    constructor() {
        super();
    }

    async init() {
        await Scanner.registerToIoc(
            this,
            path.resolve(Deno.cwd(), "src/service/"),
        );
        await Scanner.registerToIoc(
            this,
            path.resolve(Deno.cwd(), "src/api/"),
        );
        this.register(App);
        this.register(MigrationManager);
        this.register(VectorCollectionFactory);
        // Repositories live in src/db/mongo/ (the data-access layer), outside the
        // auto-scanned src/service/ + src/api/ roots, so register them explicitly.
        this.register(TraceRepository);
        this.register(ProjectRepository);
        this.register(FileRepository);
        this.register(JobRepository);
        this.register(ReportRepository);
        this.register(TestSuiteRepository);
        this.registerFactory(
            "logger",
            (
                parentClass: unknown,
                parentObjectName: string | null,
                _propertyName: string,
            ) => {
                const isClassConstructor = typeof parentClass === "function" &&
                    parentClass !== null && "name" in parentClass &&
                    typeof parentClass.name === "string";
                return new Logger(
                    isClassConstructor ? parentClass.name : parentObjectName || "<unknown>",
                );
            },
        );
        this.registerValue("container", this);
    }

    getConfig() {
        return this.resolve<ConfigService>("configService");
    }

    registerMongoConnection(mongoConnection: MongoDbConnection) {
        this.registerValue("mongoDbConnection", mongoConnection);
    }

    registerVectorConnection(vectorConnection: VectorConnection) {
        this.registerValue("vectorConnection", vectorConnection);
    }

    registerOpenAIFetcher(openAI: OpenAI) {
        this.registerValue("openai", openAI);
    }

    registerOpenAIEmbeddingFetcher(openAI: OpenAI) {
        this.registerValue("openaiEmbedding", openAI);
    }

    getMigrationManager() {
        return this.resolve<MigrationManager>("migrationManager");
    }

    getApp() {
        return this.resolve<App>("app");
    }
}
