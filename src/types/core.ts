export type VectorPointId = string & { __qdrantPointId: never };

export interface FileShard extends Record<string, unknown> {
    content: string;
    metadata: {
        chunkId: number;
        chunkSize: number;
        fileName: string;
        startPosition: number;
    };
}
