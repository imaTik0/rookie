import { MongoDbConnection } from "../db/mongo/MongoDbManager.ts";
import * as types from "../types/index.ts";
import * as db from "../db/mongo/Model.ts";
import { BaseRepository } from "../db/mongo/BaseRepository.ts";

export class ProjectRepository extends BaseRepository<types.project.ProjectId, db.Project> {
    static readonly COLLECTION_NAME = "project";

    constructor(
        mongoDbConnection: MongoDbConnection,
    ) {
        super(mongoDbConnection, ProjectRepository.COLLECTION_NAME);
    }

    async createproject(projectName: string) {
        await this.getCollection().insertOne({
            _id: this.generateId(),
            name: projectName,
        });
    }

    async getByName(projectName: string) {
        return await this.getCollection().findOne({
            name: projectName,
        });
    }

    async get(projectId: types.project.ProjectId) {
        return await this.getCollection().findOne({
            _id: projectId,
        });
    }
}
