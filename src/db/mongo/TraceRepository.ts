import { Collection } from "mongodb";
import { MongoDbConnection } from "./MongoDbManager.ts";
import * as types from "../../types/index.ts";
import { Logger } from "../../Logger.ts";

export class TraceRepository {
    private collection: Collection<types.trace.Trace>;

    constructor(
        private mongoDbConnection: MongoDbConnection,
        private logger: Logger,
    ) {
        this.collection = this.mongoDbConnection.getCollection("traces");
    }

    async create(trace: Omit<types.trace.Trace, "createdAt" | "updatedAt">): Promise<types.trace.Trace> {
        const now = Date.now();
        const newTrace: types.trace.Trace = {
            ...trace,
            createdAt: now,
            updatedAt: now,
        };
        await this.collection.insertOne(newTrace as any);
        return newTrace;
    }

    async addEvent(traceId: types.trace.TraceId, event: types.trace.TraceEvent): Promise<void> {
        await this.collection.updateOne(
            { id: traceId } as any,
            {
                $push: { events: event } as any,
                $set: { updatedAt: Date.now() },
            }
        );
    }

    async getByTestSuiteId(testSuiteId: string): Promise<types.trace.Trace[]> {
        return await this.collection.find({ testSuiteId }).sort({ createdAt: 1 }).toArray() as any;
    }

    async getById(id: types.trace.TraceId): Promise<types.trace.Trace | null> {
        return await this.collection.findOne({ id }) as any;
    }
}
