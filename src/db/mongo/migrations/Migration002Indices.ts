import { MongoDbConnection } from "../MongoDbManager.ts";

/**
 * Add performance indices for the most common report queries:
 *  - listSlim filters by projectId + type and sorts by createdAt DESC
 *  - computeRegressionStatus queries { projectId, type: "MASTER_PLAN" }
 *  - setMasterPlanId / addGapFeedback look up by _id (already indexed as primary key)
 */
export class Migration002Indices {
    static migrationName: string = "Migration002Indices";

    static async up(mongoConnection: MongoDbConnection): Promise<void> {
        const reports = mongoConnection.getCollection("reports");

        // Compound index covering the most common filter + sort pattern.
        await reports.createIndex(
            { projectId: 1, type: 1, createdAt: -1 },
            { name: "reports_projectId_type_createdAt", background: true },
        );

        // Standalone index for masterPlanId back-links (setMasterPlanId queries by _id,
        // but frontend filters by masterPlanId are common).
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
