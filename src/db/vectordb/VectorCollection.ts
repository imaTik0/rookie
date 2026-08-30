import { VectorConnection } from "./VectorManger.ts";
import * as types from "../../types/index.ts";

export class VectorCollection<T extends Record<string, unknown>> {
    protected client: VectorConnection;
    protected collectionName: string;

    constructor(vectorConnection: VectorConnection, collectionName: string) {
        this.client = vectorConnection;
        this.collectionName = collectionName;
    }

    async deleteByFileId(fileId: string): Promise<void> {
        await this.client.vectorClient.delete(this.collectionName, {
            wait: true,
            filter: {
                must: [{ key: "metadata.fileId", match: { value: fileId } }],
            },
        } as never);
    }

    async upsertPoints(points: types.vector.VectorPoint<T>[]): Promise<void> {
        try {
            await this.client.vectorClient.upsert(this.collectionName, {
                wait: true,
                points: points as never,
            });
        } catch (error) {
            const err = error as types.vector.QdrantError;
            const errorMsg = err?.data?.status?.error || err?.message || String(error);
            if (errorMsg.includes("not configured")) {
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
                    points: defaultPoints as never,
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
            return (results as unknown as types.vector.QdrantQueryResponse)
                .points as types.vector.SearchResult<T>[];
        } catch (error) {
            const err = error as types.vector.QdrantError;
            const errorMsg = err?.data?.status?.error || err?.message || String(error);
            if (errorMsg.includes("requires specified vector name")) {
                const results = await this.client.vectorClient.query(this.collectionName, {
                    query: vector,
                    limit,
                    with_payload: true,
                    using: "dense",
                });
                return (results as unknown as types.vector.QdrantQueryResponse)
                    .points as types.vector.SearchResult<T>[];
            }
            throw error;
        }
    }

    async searchHybrid(
        denseVector: types.vector.DenseVector,
        sparseVector: types.vector.SparseVector,
        limit: number = 5,
    ): Promise<types.vector.SearchResult<T>[]> {
        if (!sparseVector.indices || sparseVector.indices.length === 0) {
            return await this.search(denseVector, limit);
        }
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
            return (results as unknown as types.vector.QdrantQueryResponse)
                .points as types.vector.SearchResult<T>[];
        } catch (error) {
            const err = error as types.vector.QdrantError;
            const errorMsg = err?.data?.status?.error || err?.message || String(error);
            if (
                errorMsg.includes("not configured") || errorMsg.includes("Bad Request") ||
                errorMsg.includes("Wrong input") ||
                errorMsg.includes("requires specified vector name")
            ) {
                console.warn(
                    `[VectorCollection] hybrid BM25 search failed for "${this.collectionName}" ` +
                        `(${errorMsg.slice(0, 160)}); falling back to dense-only. ` +
                        `Re-create the collection to enable BM25 (sparse + idf modifier).`,
                );
                const results = await this.client.vectorClient.query(this.collectionName, {
                    query: denseVector,
                    limit,
                    with_payload: true,
                    using: "dense",
                });
                return (results as unknown as types.vector.QdrantQueryResponse)
                    .points as types.vector.SearchResult<T>[];
            }
            throw error;
        }
    }
}
