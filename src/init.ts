import OpenAI from "@openai/openai";
import { Container } from "./Container.ts";
import { MongoDbManager } from "./db/mongo/MongoDbManager.ts";
import { VectorManager } from "./db/vectordb/VectorManger.ts";

async function go() {
    const container = new Container();
    await container.init();
    const config = container.getConfig();
    console.log("================ STARTING ROOKIE ================");
    console.log("Loaded Configuration:");
    console.log(JSON.stringify({ 
        ...config.values, 
        openAI: { ...config.values.openAI, apiKey: "***" } 
    }, null, 2));
    console.log("=================================================");
    container.registerMongoConnection(
        MongoDbManager.init(config.values.mongoDb),
    );
    container.registerVectorConnection(
        VectorManager.init(config.values.qdrantVectorDb),
    );
    container.registerOpenAIFetcher(
        new OpenAI({ 
            apiKey: config.values.openAI.apiKey,
            baseURL: config.values.openAI.baseURL,
        }),
    );
    container.registerOpenAIEmbeddingFetcher(
        new OpenAI({ 
            apiKey: config.values.openAI.apiKey,
            baseURL: config.values.embeddings.baseURL,
        }),
    );
    await container.getMigrationManager().runAllMigrations();
    const app = container.getApp();
    app.init();
}

go().catch((e) => {
    console.log(e);
});
