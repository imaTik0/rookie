export type FileId = string & { __fileId: never };

export interface DocFile {
    metadata: { filename: string; mimetype?: string };
    buffer: Uint8Array;
}

export interface FileShard extends Record<string, unknown> {
    content: string;
    metadata: {
        fileId?: string;
        chunkId: number;
        chunkSize: number;
        fileName: string;
        startPosition: number;
        lineNumber?: number;
        section?: string;
        totalChunks?: number;
    };
}
