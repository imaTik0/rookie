import { MongoDbConnection } from "../MongoDbManager.ts";

export class Migration001Scheme {
    static migrationName: string = "Migration001Scheme";

    static async up(mongoConnection: MongoDbConnection): Promise<void> {
        await mongoConnection.getDb().createCollection("user");
    }

    static async down(mongoConnection: MongoDbConnection): Promise<void> {
        await mongoConnection.getDb().collection("user").drop();
    }
}
