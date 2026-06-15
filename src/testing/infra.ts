/**
 * Availability probes for infrastructure-backed (Tier 3) tests.
 *
 * Each returns false instead of throwing, so test files can do:
 *   const HAS_X = await xAvailable();
 *   Deno.test({ name, ignore: !HAS_X }, ...)
 * which skips cleanly when the service is absent — never aborting the run
 * (unlike a top-level Deno.exit).
 */

export async function dockerAvailable(): Promise<boolean> {
    try {
        const out = await new Deno.Command("docker", {
            args: ["--version"],
            stdout: "null",
            stderr: "null",
        }).output();
        return out.success;
    } catch {
        return false;
    }
}

export async function mongoAvailable(url: string): Promise<boolean> {
    try {
        const { MongoClient } = await import("mongodb");
        const client = new MongoClient(url, { serverSelectionTimeoutMS: 600 });
        await client.connect();
        await client.db("admin").command({ ping: 1 });
        await client.close();
        return true;
    } catch {
        return false;
    }
}

export async function qdrantAvailable(host: string, port: number): Promise<boolean> {
    try {
        const { QdrantClient } = await import("@qdrant/js-client-rest");
        const client = new QdrantClient({ host, port });
        await client.getCollections();
        return true;
    } catch {
        return false;
    }
}

export const TEST_MONGO_URL = Deno.env.get("ROOKIE_TEST_MONGO_URL") ?? "mongodb://localhost:27017";
export const TEST_QDRANT_HOST = Deno.env.get("ROOKIE_TEST_QDRANT_HOST") ?? "127.0.0.1";
export const TEST_QDRANT_PORT = Number(Deno.env.get("ROOKIE_TEST_QDRANT_PORT") ?? "6333");
