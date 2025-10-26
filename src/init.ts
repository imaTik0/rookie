import { OpenAI } from "https://jsr.io/@openai/openai/5.16.0/client.ts";
import { Container } from "./Container.ts";
import { MongoDbManager } from "./db/mongo/MongoDbManager.ts";
import { VectorManager } from "./db/vectordb/VectorManger.ts";

async function go() {
    const container = new Container();
    await container.init();
    const config = container.getConfig();
    config.loadFile("conf/config.json");
    container.registerMongoConnection(
        MongoDbManager.init(config.values.mongoDb),
    );
    container.registerVectorConnection(
        VectorManager.init(config.values.qdrantVectorDb),
    );
    container.registerOpenAIFetcher(
        new OpenAI({ apiKey: config.values.openAI.apiKey }),
    );
    await container.getMigrationManager().runAllMigrations();
    const app = container.getApp();
    app.init();
}

go().catch((e) => {
    console.log(e);
});
