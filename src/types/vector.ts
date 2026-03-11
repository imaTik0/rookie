import { VectorPointId } from "./core.ts";

export interface SparseVector {
    indices: number[];
    values: number[];
}

export type DenseVector = number[];

export interface NamedVectors {
    [name: string]: DenseVector | SparseVector;
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
