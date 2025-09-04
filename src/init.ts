import { Container } from "./Container.ts";
import { MongoDbManager } from "./db/mongo/MongoDbManager.ts";
import { QdrantManager } from "./db/qdrant/QdrantManger.ts";

async function go() {
    const container = new Container();
    await container.init();
    const config = container.getConfig();
    config.loadFile("conf/config.json");
    container.registerMongoConnection(MongoDbManager.init(config.values.mongoDb));
    container.registerQdrantConnection(QdrantManager.init(config.values.qdrantVectorDb))
    await container.getMigrationManager().runAllMigrations();
    const app = container.getApp();
    app.init();
}

go().catch(e => {
    console.log(e);
})