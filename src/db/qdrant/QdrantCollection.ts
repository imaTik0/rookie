import { QdrantConnection } from "./QdrantManger.ts";
import * as types from "../../types/index.ts";

export interface QdrantPoint {
    id: types.core.QdrantPointId
    vector: number[];
    payload: Record<string, unknown>
}

export class QdrantCollection<T> {

    protected client: QdrantConnection;
    protected collectionName: string;

    constructor(qdrantConnection: QdrantConnection, collectionName: string) {
        this.client = qdrantConnection;
        this.collectionName = collectionName;
    }

    async upsertPoints<T extends QdrantPoint>(points: T[]) {
        await this.client.qdrantClient.upsert(this.collectionName, {
            wait: true,
            points,
        });
    }

    async search(vector: number[], limit: number = 3) {
        return await this.client.qdrantClient.query(this.collectionName, {
            query: vector,
            limit,
            with_payload: true,
        }) as T;
    }
}