import * as path from "@std/path";
import * as types from "../types/index.ts";
import * as db from "../db/mongo/Model.ts";

interface ChunkingOptions {
    chunkSize: number;
    chunkOverlap: number;
}

const SUPPORTED_TEXT_MIMES = [
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
    "application/javascript",
    "text/html",
    "text/xml",
    "application/xml",
];

export class FileHelpers {
    private readonly textDecoder: TextDecoder;

    constructor() {
        this.textDecoder = new TextDecoder("utf-8");
    }

    public chunkDbFile(
        dbFile: db.File,
        options: ChunkingOptions = { chunkSize: 1000, chunkOverlap: 200 },
    ): types.file.FileShard[] {
        if (!this._isChunkable(dbFile.mimetype)) {
            throw new Error(
                `File is not chunkable (MIME type ${dbFile.mimetype} is not supported text).`,
            );
        }

        const content = this.textDecoder.decode(dbFile.data.buffer);

        return this._chunkText(content, dbFile.filename, options);
    }

    public async chunkFileFromPath(
        filePath: string,
        options: ChunkingOptions = { chunkSize: 1000, chunkOverlap: 200 },
    ): Promise<types.file.FileShard[]> {
        const content = await Deno.readTextFile(filePath);
        const fileName = path.basename(filePath);
        return this._chunkText(content, fileName, options);
    }

    public async loadMarkdownContentFromDir(dir: string): Promise<string[]> {
        let results: string[] = [];
        const list = Deno.readDirSync(dir);

        for (const file of list) {
            const fullPath = path.resolve(dir, file.name);
            if (file.isDirectory) {
                results = results.concat(
                    await this.loadMarkdownContentFromDir(fullPath),
                );
            } else if (path.extname(file.name) === ".md") {
                const content = await Deno.readTextFile(fullPath);
                results.push(content);
            }
        }
        return results;
    }

    public async overwriteFile(filePath: string, content: string): Promise<void> {
        try {
            await Deno.writeTextFile(filePath, content, {
                append: false,
            });
        } catch (error) {
            console.error(`Error writing content to "${filePath}":`, error);
            throw error;
        }
    }

    private _isChunkable(mimetype: string): boolean {
        return SUPPORTED_TEXT_MIMES.some((supportedType) => mimetype.startsWith(supportedType));
    }

    private _chunkText(
        content: string,
        fileName: string,
        options: ChunkingOptions,
    ): types.file.FileShard[] {
        const chunks: types.file.FileShard[] = [];
        let chunkNumber = 1;
        let globalPosition = 0; // Tracks our position in the original content string

        // Helper to push a finalized chunk
        const pushChunk = (
            chunkContent: string,
            startPosition: number,
        ): void => {
            if (chunkContent.length === 0) {
                return;
            }
            chunks.push({
                content: chunkContent,
                metadata: {
                    fileName: fileName,
                    chunkId: chunkNumber++,
                    chunkSize: chunkContent.length,
                    startPosition: startPosition,
                },
            });
        };

        const paragraphs = content.split("\n");
        let currentChunkParas: string[] = [];
        let currentChunkLength = 0;
        let currentChunkStartPosition = 0;

        for (let i = 0; i < paragraphs.length; i++) {
            const para = paragraphs[i];
            const paraStartPosition = globalPosition;

            // Advance global position. Add 1 for the '\n' if it's not the last paragraph.
            globalPosition += para.length;
            if (i < paragraphs.length - 1) {
                globalPosition++; // Account for the '\n'
            }

            // --- CASE 1: Single paragraph is longer than chunkSize ---
            // This is the exception for a very long line with no breaks.
            // We must split this paragraph using the original sliding window logic.
            if (para.length > options.chunkSize) {
                // First, finalize any chunk we were building.
                if (currentChunkParas.length > 0) {
                    pushChunk(
                        currentChunkParas.join("\n"),
                        currentChunkStartPosition,
                    );
                    currentChunkParas = [];
                    currentChunkLength = 0;
                }

                // Now, split the long paragraph using the sliding window
                let subPos = 0;
                while (subPos < para.length) {
                    const end = Math.min(
                        subPos + options.chunkSize,
                        para.length,
                    );
                    const subContent = para.slice(subPos, end);
                    pushChunk(subContent, paraStartPosition + subPos);

                    if (end === para.length) {
                        break;
                    }

                    // Apply overlap, but ensure we don't get stuck in a loop
                    const nextPos = subPos + options.chunkSize - options.chunkOverlap;
                    subPos = Math.max(nextPos, subPos + 1); // Ensure progress
                }

                // This paragraph is fully processed, set start for the next
                currentChunkStartPosition = globalPosition;
                continue;
            }

            // --- Calculate potential new chunk size ---
            // Add 1 for the newline if this is not the first paragraph in the chunk
            const lengthWithNewPara = currentChunkLength +
                (currentChunkParas.length > 0 ? 1 : 0) +
                para.length;

            // --- CASE 2: Adding this paragraph makes the chunk too big ---
            if (lengthWithNewPara > options.chunkSize) {
                // We've gone over. We need to decide:
                // 1. Finalize the old chunk and start a new one?
                // 2. Or, create a "too-big" chunk to avoid a "too-small" one?

                // "Too small" = less than 50% of chunk size.
                const currentIsTooSmall = currentChunkLength < options.chunkSize * 0.5;
                // "Too big" = more than 150% of chunk size.
                const potentialIsTooBig = lengthWithNewPara > options.chunkSize * 1.5;

                if (
                    currentChunkParas.length > 0 && // We have a chunk to finalize
                    (!currentIsTooSmall || potentialIsTooBig)
                ) {
                    // Finalize the current chunk IF:
                    // 1. It's NOT "too small". (It's a good size).
                    // 2. OR, adding the new para would make it "too big".
                    pushChunk(
                        currentChunkParas.join("\n"),
                        currentChunkStartPosition,
                    );

                    // Start new chunk with the current paragraph
                    currentChunkParas = [para];
                    currentChunkLength = para.length;
                    currentChunkStartPosition = paraStartPosition;
                } else {
                    // Create an "exception" chunk (either "too small" or "too big")
                    // This happens if:
                    // 1. The current chunk is empty.
                    // 2. The current chunk is "too small" AND the new one is NOT "too big".
                    if (currentChunkParas.length === 0) {
                        currentChunkStartPosition = paraStartPosition;
                    }
                    currentChunkParas.push(para);
                    currentChunkLength = lengthWithNewPara - (currentChunkParas.length > 1 ? 1 : 0);
                    if (currentChunkParas.length === 1) {
                        currentChunkLength = para.length; // No newline
                    }
                }
            } // --- CASE 3: Paragraph fits perfectly ---
            else {
                // The paragraph fits, just add it.
                if (currentChunkParas.length === 0) {
                    currentChunkStartPosition = paraStartPosition;
                }
                currentChunkParas.push(para);
                currentChunkLength = lengthWithNewPara - (currentChunkParas.length > 1 ? 1 : 0);
                if (currentChunkParas.length === 1) {
                    currentChunkLength = para.length; // No newline
                }
            }
        }

        // After the loop, push any remaining chunk
        if (currentChunkParas.length > 0) {
            pushChunk(
                currentChunkParas.join("\n"),
                currentChunkStartPosition,
            );
        }

        // If content was empty or just newlines, we might have no chunks.
        if (chunks.length === 0 && content.length > 0) {
            pushChunk(content, 0);
        } else if (chunks.length === 0 && content.length === 0) {
            return []; // Return empty array for empty content
        }

        // Final pass to add totalChunks metadata
        const totalChunks = chunks.length;
        return chunks.map((chunk) => ({
            ...chunk,
            metadata: {
                ...chunk.metadata,
                totalChunks,
            },
        }));
    }
}
