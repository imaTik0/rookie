import * as path from "@std/path";
import { IOC } from "./ioc/index.ts";
import { Scanner } from "./ioc/Scanner.ts";
import { Logger } from "./Logger.ts";
import { App } from "./App.ts";
import { MongoDbConnection } from "./db/mongo/MongoDbManager.ts";
import { ConfigService } from "./service/ConfigService.ts";
import { MigrationManager } from "./db/mongo/MigrationManager.ts";
import { QdrantConnection } from "./db/qdrant/QdrantManger.ts";
import { QdrantCollectionFactory } from "./db/qdrant/QdrantCollectionFactory.ts";

export class Container extends IOC {
    constructor() {
        super()
    }

    async init() {
        await Scanner.registerToIoc(this, path.resolve(Deno.cwd(), "src/service/"));
        this.register(App);
        this.register(MigrationManager);
        this.register(QdrantCollectionFactory)
        this.registerFactory("logger", (parentClass: unknown, parentObjectName: string|null, _propertyName: string) => {
            const isClassConstructor = (typeof parentClass === "function" && parentClass !== null && "name" in parentClass && typeof parentClass.name === "string");
            return new Logger(isClassConstructor ? parentClass.name : parentObjectName || "<unknown>");
        })
    }

    getConfig() {
        return this.resolve<ConfigService>("configService");
    }

    registerMongoConnection(mongoConnection: MongoDbConnection) {
        this.registerValue("mongoDbConnection", mongoConnection);
    }

    registerQdrantConnection(qdrantConnection: QdrantConnection) {
        this.registerValue("qdrantConnection", qdrantConnection);
    }

    getMigrationManager() {
        return this.resolve<MigrationManager>("migrationManager");
    }

    getApp() {
        return this.resolve<App>("app");
    }
}