import * as mongodb from "mongodb";
import { MongoDbConnection } from "./MongoDbManager.ts";

export class BaseRepository<K extends string, T extends mongodb.Document> { 

    constructor(
       private mongoDbConnection: MongoDbConnection,
       private collectionName: string,
    ) {
    }

    protected getCollection() {
        return this.mongoDbConnection.getCollection<T>(this.collectionName)
    }

    protected generateId() {
        return new mongodb.ObjectId().toHexString() as K;
    }
} 