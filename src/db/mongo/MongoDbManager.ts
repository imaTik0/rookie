import * as mongodb from "mongodb";

export class MongoDbConnection {
    constructor(
        private client: mongodb.MongoClient, 
        private db: mongodb.Db
    ) {}

    getCollection<T extends mongodb.Document>(collectionName: string): mongodb.Collection<T> {
        if (!this.db) {
            throw new Error("Database not connected.");
        }
        return this.db.collection<T>(collectionName);
    }

    getDb() {
        return this.db;
    }
    
    close() {
        this.client.close();
    }
}


export class MongoDbManager { 
    private client: mongodb.MongoClient;
    private db: mongodb.Db;
    
    constructor(
        url: string,
        dbName: string
    ) {
        this.client = new mongodb.MongoClient(url);
        this.db = this.client.db(dbName)
    }

    static init(dbConfig: {url: string, dbName: string}) {
        const client = new mongodb.MongoClient(dbConfig.url);
        const db = client.db(dbConfig.dbName)
        return new MongoDbConnection(client, db);
    }
}   