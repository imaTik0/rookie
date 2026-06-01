export type FileId = string & { __fileId: never };

export interface FileShard extends Record<string, unknown> {
    content: string;
    metadata: {
        /** Source file ID — used to delete chunks from Qdrant when the file is removed. */
        fileId?: string;
        chunkId: number;
        chunkSize: number;
        fileName: string;
        startPosition: number;
        /** 1-based line number where this chunk starts in the source file. */
        lineNumber?: number;
        /** Markdown heading context this chunk falls under, if any. */
        section?: string;
        totalChunks?: number;
    };
}
