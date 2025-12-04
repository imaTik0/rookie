export type FileId = string & { __fileId: never };

export interface FileShard extends Record<string, unknown> {
    content: string;
    metadata: {
        chunkId: number;
        chunkSize: number;
        fileName: string;
        startPosition: number;
    };
}
