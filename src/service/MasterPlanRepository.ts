import { MongoDbConnection } from "../db/mongo/MongoDbManager.ts";
import * as types from "../types/index.ts";
import * as db from "../db/mongo/Model.ts";
import { BaseRepository } from "../db/mongo/BaseRepository.ts";

export class MasterPlanRepository extends BaseRepository<types.planner.MasterPlanId, db.MasterPlanReport> {
    static readonly COLLECTION_NAME = "master_plans";

    constructor(
        mongoDbConnection: MongoDbConnection,
    ) {
        super(mongoDbConnection, MasterPlanRepository.COLLECTION_NAME);
    }

    async create(
        data: Omit<db.MasterPlanReport, "_id" | "createdAt">,
    ): Promise<db.MasterPlanReport> {
        const newPlan: db.MasterPlanReport = {
            _id: this.generateId(),
            ...data,
            createdAt: new Date(),
        };

        await this.getCollection().insertOne(newPlan);
        return newPlan;
    }

    async get(id: types.planner.MasterPlanId): Promise<db.MasterPlanReport | null> {
        return await this.getCollection().findOne({
            _id: id,
        });
    }

    async list(
        pagination: { page: number; limit: number },
    ): Promise<{ reports: db.MasterPlanReport[]; total: number }> {
        const { page, limit } = pagination;
        const skip = (page - 1) * limit;
        const collection = this.getCollection();

        const [reports, total] = await Promise.all([
            collection.find().sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
            collection.countDocuments(),
        ]);

        return { reports: reports as db.MasterPlanReport[], total };
    }
}
