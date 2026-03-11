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
        try {
            await this.client.vectorClient.upsert(this.collectionName, {
                wait: true,
                points: points as any,
            });
        } catch (error: any) {
            if (error?.data?.status?.error?.includes("not configured")) {
                const defaultPoints = points.map((point) => {
                    const nv = point.vector as types.vector.NamedVectors;
                    return {
                        id: point.id,
                        vector: nv.dense || nv,
                        payload: point.payload,
                    };
                });
                await this.client.vectorClient.upsert(this.collectionName, {
                    wait: true,
                    points: defaultPoints as any,
                });
                return;
            }
            throw error;
        }
    }

    async search(
        vector: types.vector.DenseVector,
        limit: number = 3,
    ): Promise<types.vector.SearchResult<T>[]> {
        try {
            const results = await this.client.vectorClient.query(this.collectionName, {
                query: vector,
                limit,
                with_payload: true,
            });
            return (results as any).points || [];
        } catch (error: any) {
            const errorMsg = error?.data?.status?.error || error?.message || String(error);
            if (errorMsg.includes("requires specified vector name")) {
                const results = await this.client.vectorClient.query(this.collectionName, {
                    query: vector,
                    limit,
                    with_payload: true,
                    using: "dense",
                });
                return (results as any).points || [];
            }
            throw error;
        }
    }

    async searchHybrid(
        denseVector: types.vector.DenseVector,
        sparseVector: types.vector.SparseVector,
        limit: number = 5,
    ): Promise<types.vector.SearchResult<T>[]> {
        try {
            const results = await this.client.vectorClient.query(this.collectionName, {
                prefetch: [
                    { query: denseVector, limit, using: "dense" },
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
            return (results as any).points || [];
        } catch (error: any) {
            const errorMsg = error?.data?.status?.error || error?.message || String(error);
            if (errorMsg.includes("not configured") || errorMsg.includes("Bad Request") || errorMsg.includes("Wrong input") || errorMsg.includes("requires specified vector name")) {
                const results = await this.client.vectorClient.query(this.collectionName, {
                    query: denseVector,
                    limit,
                    with_payload: true,
                    using: "dense",
                });
                return (results as any).points || [];
            }
            throw error;
        }
    }
}
