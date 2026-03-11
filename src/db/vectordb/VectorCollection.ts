import { VectorConnection } from "./VectorManger.ts";
import * as types from "../../types/index.ts";

export class VectorCollection<T extends Record<string, unknown>> {
    protected client: VectorConnection;
    protected collectionName: string;

    constructor(vectorConnection: VectorConnection, collectionName: string) {
        this.client = vectorConnection;
        this.collectionName = collectionName;
    }

    async upsertPoints(points: types.vector.VectorPoint<T>[]) {
        await this.client.vectorClient.upsert(this.collectionName, {
            wait: true,
            points: points as any,
        });
    }

    async search(vector: types.vector.DenseVector, limit: number = 3): Promise<types.vector.SearchResult<T>[]> {
        const results = await this.client.vectorClient.query(this.collectionName, {
            query: vector,
            limit,
            with_payload: true,
        });
        return results as unknown as types.vector.SearchResult<T>[];
    }

    async searchHybrid(
        denseVector: types.vector.DenseVector,
        sparseVector: types.vector.SparseVector,
        limit: number = 5,
    ): Promise<types.vector.SearchResult<T>[]> {
        const results = await this.client.vectorClient.query(this.collectionName, {
            prefetch: [
                { query: denseVector, limit, using: "" },
                {
                    query: sparseVector,
                    limit,
                    using: "sparse",
                },
            ],
            query: { fusion: "rrf" },
            limit,
            with_payload: true,
        });
        return results as unknown as types.vector.SearchResult<T>[];
    }
}
