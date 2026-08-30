import { assert, assertEquals } from "@std/assert";
import { MongoDbManager } from "./MongoDbManager.ts";
import { MigrationManager } from "./MigrationManager.ts";
import { ProjectRepository } from "./ProjectRepository.ts";
import type * as types from "../../types/index.ts";
import { mongoAvailable, TEST_MONGO_URL } from "../../testing/infra.ts";
import { fakeLogger } from "../../testing/fakes.ts";

const HAS_MONGO = await mongoAvailable(TEST_MONGO_URL);
const dbName = `rookie_test_${crypto.randomUUID().slice(0, 8)}`;

Deno.test({ name: "[mongo] ProjectRepository CRUD round-trip", ignore: !HAS_MONGO }, async () => {
    const conn = MongoDbManager.init({ url: TEST_MONGO_URL, dbName });
    const repo = new ProjectRepository(conn);
    try {
        const created = await repo.create({ projectName: "Demo" });
        assertEquals(created.projectName, "Demo");

        const fetched = await repo.get(created._id);
        assertEquals(fetched?._id, created._id);

        const renamed = await repo.update(created._id, { projectName: "Renamed" });
        assertEquals(renamed?.projectName, "Renamed");

        const withFiles = await repo.addFiles(created._id, ["f1", "f2"] as types.file.FileId[]);
        assertEquals(withFiles?.files.length, 2);

        const lessFiles = await repo.removeFiles(created._id, ["f1"] as types.file.FileId[]);
        assertEquals(lessFiles?.files, ["f2"] as types.file.FileId[]);

        assertEquals(await repo.delete(created._id), true);
        assertEquals(await repo.get(created._id), null);
    } finally {
        await conn.getDb().dropDatabase();
        conn.close();
    }
});

Deno.test(
    { name: "[mongo] MigrationManager.runAllMigrations is idempotent", ignore: !HAS_MONGO },
    async () => {
        const conn = MongoDbManager.init({ url: TEST_MONGO_URL, dbName: `${dbName}_mig` });
        const mgr = new MigrationManager(conn, fakeLogger());
        try {
            await mgr.runAllMigrations();
            await mgr.runAllMigrations();

            const applied = await conn.getCollection("migrations").countDocuments();
            assert(applied >= 2, `expected >=2 applied migrations, got ${applied}`);
        } finally {
            await conn.getDb().dropDatabase();
            conn.close();
        }
    },
);
