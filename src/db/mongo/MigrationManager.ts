import { Injectable } from "../../ioc/decorator.ts";
import { Logger } from "../../Logger.ts";
import { MongoDbConnection } from "./MongoDbManager.ts";
import { Migration001Scheme } from "./migrations/Migration001Scheme.ts";
import { Migration002Indices } from "./migrations/Migration002Indices.ts";

interface Migration {
    migrationName: string;
    up(mongoConnection: MongoDbConnection): Promise<void>;
    down(mongoConnection: MongoDbConnection): Promise<void>;
}

const migrations: Migration[] = [
    Migration001Scheme,
    Migration002Indices,
];

@Injectable()
export class MigrationManager {
    private migrationsCollectionName = "migrations";
    private migrationsCollection;

    constructor(
        private mongoDbConnection: MongoDbConnection,
        private logger: Logger,
    ) {
        this.migrationsCollection = this.mongoDbConnection.getCollection(
            this.migrationsCollectionName,
        );
    }

    async initialize(): Promise<void> {
        const collections = await this.mongoDbConnection.getDb()
            .listCollections({
                migrationName: this.migrationsCollectionName,
            }).toArray();
        if (collections.length === 0) {
            await this.mongoDbConnection.getDb().createCollection(
                this.migrationsCollectionName,
            );
            this.logger.log("Migrations collection created");
        }
    }

    async runMigration(migration: Migration): Promise<void> {
        const isMigrated = await this.migrationsCollection.findOne({
            migrationName: migration.migrationName,
        });
        if (isMigrated) {
            this.logger.log(
                `Migration ${migration.migrationName} has already been applied.`,
            );
            return;
        }

        this.logger.log(`Running migration: ${migration.migrationName}`);
        await migration.up(this.mongoDbConnection);
        await this.migrationsCollection.insertOne({
            migrationName: migration.migrationName,
            date: new Date(),
        });
        this.logger.log(`Migration ${migration.migrationName} completed`);
    }

    async rollbackMigration(migration: Migration): Promise<void> {
        const isMigrated = await this.migrationsCollection.findOne({
            migrationName: migration.migrationName,
        });
        if (!isMigrated) {
            this.logger.log(
                `Migration ${migration.migrationName} has not been applied, so it cannot be rolled back.`,
            );
            return;
        }

        this.logger.log(`Rolling back migration: ${migration.migrationName}`);
        await migration.down(this.mongoDbConnection);
        await this.migrationsCollection.deleteOne({
            migrationName: migration.migrationName,
        });
        this.logger.log(`Migration ${migration.migrationName} rolled back`);
    }

    async runAllMigrations(): Promise<void> {
        for (const migration of migrations) {
            await this.runMigration(migration);
        }
        this.logger.log("All migrations completed");
    }
}
