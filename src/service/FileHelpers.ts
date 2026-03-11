import * as path from "@std/path";
import * as types from "../types/index.ts";
import * as db from "../db/mongo/Model.ts";
import striptags from "striptags";

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

        let content = this.textDecoder.decode(dbFile.data.buffer);
        content = striptags(content);

        return this._chunkText(content, dbFile.filename, options);
    }

    public async chunkFileFromPath(
        filePath: string,
        options: ChunkingOptions = { chunkSize: 1000, chunkOverlap: 200 },
    ): Promise<types.file.FileShard[]> {
        let content = await Deno.readTextFile(filePath);
        content = striptags(content);
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
        let globalPosition = 0;

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

            globalPosition += para.length;
            if (i < paragraphs.length - 1) {
                globalPosition++;
            }

            if (para.length > options.chunkSize) {
                if (currentChunkParas.length > 0) {
                    pushChunk(
                        currentChunkParas.join("\n"),
                        currentChunkStartPosition,
                    );
                    currentChunkParas = [];
                    currentChunkLength = 0;
                }

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

                    const nextPos = subPos + options.chunkSize - options.chunkOverlap;
                    subPos = Math.max(nextPos, subPos + 1);
                }

                currentChunkStartPosition = globalPosition;
                continue;
            }

            const lengthWithNewPara = currentChunkLength +
                (currentChunkParas.length > 0 ? 1 : 0) +
                para.length;

            if (lengthWithNewPara > options.chunkSize) {
                const currentIsTooSmall = currentChunkLength < options.chunkSize * 0.5;
                const potentialIsTooBig = lengthWithNewPara > options.chunkSize * 1.5;

                if (
                    currentChunkParas.length > 0 &&
                    (!currentIsTooSmall || potentialIsTooBig)
                ) {
                    pushChunk(
                        currentChunkParas.join("\n"),
                        currentChunkStartPosition,
                    );

                    currentChunkParas = [para];
                    currentChunkLength = para.length;
                    currentChunkStartPosition = paraStartPosition;
                } else {
                    if (currentChunkParas.length === 0) {
                        currentChunkStartPosition = paraStartPosition;
                    }
                    currentChunkParas.push(para);
                    currentChunkLength = lengthWithNewPara - (currentChunkParas.length > 1 ? 1 : 0);
                    if (currentChunkParas.length === 1) {
                        currentChunkLength = para.length;
                    }
                }
            } else {
                if (currentChunkParas.length === 0) {
                    currentChunkStartPosition = paraStartPosition;
                }
                currentChunkParas.push(para);
                currentChunkLength = lengthWithNewPara - (currentChunkParas.length > 1 ? 1 : 0);
                if (currentChunkParas.length === 1) {
                    currentChunkLength = para.length;
                }
            }
        }

        if (currentChunkParas.length > 0) {
            pushChunk(
                currentChunkParas.join("\n"),
                currentChunkStartPosition,
            );
        }

        if (chunks.length === 0 && content.length > 0) {
            pushChunk(content, 0);
        } else if (chunks.length === 0 && content.length === 0) {
            return [];
        }

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
