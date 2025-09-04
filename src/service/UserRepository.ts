import { MongoDbConnection } from "../db/mongo/MongoDbManager.ts";
import * as types from "../types/index.ts";
import * as db from "../db/mongo/Model.ts";
import { BaseRepository } from "../db/mongo/BaseRepository.ts";

export class UserRepository extends BaseRepository<types.user.UserId, db.User> { 
    static readonly COLLECTION_NAME = "user";

    constructor(
        mongoDbConnection: MongoDbConnection,
    ) {
        super(mongoDbConnection, UserRepository.COLLECTION_NAME);
    }

    async createUser(userName: string) {
        await this.getCollection().insertOne({
            _id: this.generateId(),
            name: userName
        })
    }

    async getByName(username: string) {
        return await this.getCollection().findOne({
            name: username,
        });
    }

    async get(userId: types.user.UserId) {
        return await this.getCollection().findOne({
            _id: userId,
        });
    }
}
