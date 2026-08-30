import { assert } from "@std/assert";
import { VectorManager } from "./VectorManger.ts";
import { qdrantAvailable, TEST_QDRANT_HOST, TEST_QDRANT_PORT } from "../../testing/infra.ts";

const HAS_QDRANT = await qdrantAvailable(TEST_QDRANT_HOST, TEST_QDRANT_PORT);

Deno.test(
    { name: "[qdrant] create, list and delete a collection", ignore: !HAS_QDRANT },
    async () => {
        const conn = VectorManager.init({ host: TEST_QDRANT_HOST, port: TEST_QDRANT_PORT });
        const client = conn.vectorClient;
        const name = `rookie_test_${crypto.randomUUID().slice(0, 8)}`;
        try {
            await client.createCollection(name, { vectors: { size: 4, distance: "Cosine" } });
            const { collections } = await client.getCollections();
            assert(collections.some((c) => c.name === name), "created collection should be listed");
        } finally {
            await client.deleteCollection(name);
        }
        const { collections } = await client.getCollections();
        assert(!collections.some((c) => c.name === name), "collection should be gone after delete");
    },
);
