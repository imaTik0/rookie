import OpenAI from "@openai/openai";
import { Container } from "./Container.ts";
import { MongoDbManager } from "./db/mongo/MongoDbManager.ts";
import { VectorManager } from "./db/vectordb/VectorManger.ts";

// Safety net: a stray background promise rejection (e.g. an embedding timeout
// during async indexing) must NOT terminate the whole server — that would abort
// an entire experiment batch. Log it and stay up; individual requests still fail
// on their own error paths.
globalThis.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
    console.error("[unhandledRejection] server kept alive:", event.reason);
});

async function go() {
    const container = new Container();
    await container.init();
    const config = container.getConfig();
    console.log("================ STARTING ROOKIE ================");
    console.log("Loaded Configuration:");
    console.log(JSON.stringify(
        {
            ...config.values,
            openAI: { ...config.values.openAI, apiKey: "***" },
        },
        null,
        2,
    ));
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
