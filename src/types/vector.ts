import { VectorPointId } from "./core.ts";

export interface SparseVector {
    indices: number[];
    values: number[];
}

export type DenseVector = number[];

export interface TextVector {
    text: string;
    model: string;
}

export interface NamedVectors {
    [name: string]: DenseVector | SparseVector | TextVector;
}

export type Vector = DenseVector | NamedVectors;

export interface VectorPoint<T extends Record<string, unknown>> {
    id: VectorPointId;
    vector: Vector;
    payload: T;
}

export interface SearchResult<T> {
    id: string | number;
    score: number;
    payload?: T;
    vector?: Vector;
}

export interface QdrantErrorStatus {
    error: string;
}

export interface QdrantResponseStatus {
    status: QdrantErrorStatus;
}

export interface QdrantPoint {
    id: string | number;
    version: number;
    score: number;
    payload?: Record<string, unknown>;
    vector?: Record<string, unknown>;
}

export interface QdrantQueryResponse {
    points: QdrantPoint[];
}

export type QdrantError = {
    type: string;
    message: string;
    stack?: string;
    headers: Record<string, string>;
    url: string;
    status: number;
    statusText: string;
    data: QdrantResponseStatus;
};
