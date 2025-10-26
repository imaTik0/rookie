import { VectorConnection } from "./VectorManger.ts";
import * as types from "../../types/index.ts";

export interface Point<T extends Record<string, unknown>> {
    id: types.core.VectorPointId;
    vector: number[];
    payload: T;
}

export class VectorCollection<T> {
    protected client: VectorConnection;
    protected collectionName: string;

    constructor(vectorConnection: VectorConnection, collectionName: string) {
        this.client = vectorConnection;
        this.collectionName = collectionName;
    }

    async upsertPoints<T extends Record<string, unknown>>(points: Point<T>[]) {
        await this.client.vectorClient.upsert(this.collectionName, {
            wait: true,
            points: points,
        });
    }

    async search(vector: number[], limit: number = 3) {
        return await this.client.vectorClient.query(this.collectionName, {
            query: vector,
            limit,
            with_payload: true,
        }) as T;
    }
}
