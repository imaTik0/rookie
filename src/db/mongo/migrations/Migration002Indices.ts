import { MongoDbConnection } from "../MongoDbManager.ts";

export class Migration002Indices {
    static migrationName: string = "Migration002Indices";

    static async up(mongoConnection: MongoDbConnection): Promise<void> {
        const reports = mongoConnection.getCollection("reports");

        await reports.createIndex(
            { projectId: 1, type: 1, createdAt: -1 },
            { name: "reports_projectId_type_createdAt", background: true },
        );

        await reports.createIndex(
            { masterPlanId: 1 },
            { name: "reports_masterPlanId", sparse: true, background: true },
        );
    }

    static async down(mongoConnection: MongoDbConnection): Promise<void> {
        const reports = mongoConnection.getCollection("reports");
        await reports.dropIndex("reports_projectId_type_createdAt");
        await reports.dropIndex("reports_masterPlanId");
    }
}
