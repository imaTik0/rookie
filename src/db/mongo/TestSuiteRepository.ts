import { Injectable } from "../../ioc/decorator.ts";
import { MongoDbConnection } from "./MongoDbManager.ts";
import * as db from "./Model.ts";
import { BaseRepository } from "./BaseRepository.ts";
import * as types from "../../types/index.ts";

type UpdateDTO = Partial<Omit<db.TestSuite, "createdAt" | "updatedAt" | "_id">>;
type CreateDTO = Omit<db.TestSuite, "createdAt" | "updatedAt" | "_id">;

@Injectable()
export class TestSuiteRepository extends BaseRepository<types.test.TestSuiteId, db.TestSuite> {
    static readonly COLLECTION_NAME = "testsuites";

    constructor(
        mongoDbConnection: MongoDbConnection,
    ) {
        super(mongoDbConnection, TestSuiteRepository.COLLECTION_NAME);
    }

    async create(
        data: CreateDTO,
    ): Promise<db.TestSuite> {
        const now = new Date();
        const newTestSuite: db.TestSuite = {
            _id: this.generateId() as types.test.TestSuiteId,
            projectId: data.projectId,
            initialContext: data.initialContext,
            functionTemplate: data.functionTemplate,
            minimalStoryLength: data.minimalStoryLength,
            maximalStoryLength: data.maximalStoryLength,
            mode: data.mode,
            userGoal: data.userGoal,
            packageOverrides: data.packageOverrides,
            withoutDocs: data.withoutDocs,
            frozenPrograms: data.frozenPrograms,
            expectedApis: data.expectedApis,
            createdAt: now,
            updatedAt: now,
        };

        await this.getCollection().insertOne(newTestSuite);
        return newTestSuite;
    }

    async get(testSuiteId: types.test.TestSuiteId): Promise<db.TestSuite | null> {
        return await this.getCollection().findOne({
            _id: testSuiteId,
        });
    }

    async list(
        pagination: { page: number; limit: number },
        filter: { projectId?: types.project.ProjectId } = {},
    ): Promise<{ testSuites: db.TestSuite[]; total: number }> {
        const { page, limit } = pagination;
        const skip = (page - 1) * limit;
        const collection = this.getCollection();

        const query: Record<string, unknown> = {};
        if (filter.projectId) query.projectId = filter.projectId;

        const [testSuites, total] = await Promise.all([
            collection.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit)
                .toArray(),
            collection.countDocuments(query),
        ]);

        return { testSuites: testSuites as db.TestSuite[], total };
    }

    async update(
        testSuiteId: types.test.TestSuiteId,
        data: UpdateDTO,
    ): Promise<db.TestSuite | null> {
        const updateDoc = {
            $set: {
                ...data,
                updatedAt: new Date(),
            },
        };
        const result = await this.getCollection().findOneAndUpdate(
            { _id: testSuiteId },
            updateDoc,
            { returnDocument: "after" },
        );
        return result;
    }

    async delete(testSuiteId: types.test.TestSuiteId): Promise<boolean> {
        const result = await this.getCollection().deleteOne({ _id: testSuiteId });
        return result.deletedCount === 1;
    }
}
