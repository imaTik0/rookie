// THIS SERVICE HAS TO BE REFACTORED

import * as path from "@std/path";
import * as types from "../types/index.ts";

interface ChunkingOptions {
    chunkSize: number;
    chunkOverlap: number;
}

export class FileLoaderService {
    async loadAndChunk(
        filePath: string,
        options: ChunkingOptions = { chunkSize: 1000, chunkOverlap: 200 },
    ): Promise<types.core.FileShard[]> {
        const content = await Deno.readTextFile(filePath);
        const chunks: types.core.FileShard[] = [];
        let chunkNumber = 1;
        let position = 0;

        if (content.length <= options.chunkSize) {
            chunks.push({
                content,
                metadata: {
                    fileName: path.basename(filePath),
                    chunkId: chunkNumber,
                    chunkSize: content.length,
                    startPosition: position,
                },
            });
            return chunks;
        }

        while (position < content.length) {
            const end = Math.min(position + options.chunkSize, content.length);
            const chunkContent = content.slice(position, end);

            chunks.push({
                content: chunkContent,
                metadata: {
                    fileName: path.basename(filePath),
                    chunkId: chunkNumber,
                    chunkSize: chunkContent.length,
                    startPosition: position,
                },
            });

            position += options.chunkSize - options.chunkOverlap;
            chunkNumber++;

            if (position >= content.length && end < content.length) {
                const lastChunkContent = content.slice(
                    end - options.chunkOverlap,
                );
                if (lastChunkContent.trim()) {
                    chunks.push({
                        content: chunkContent,
                        metadata: {
                            fileName: path.basename(filePath),
                            chunkId: chunkNumber,
                            chunkSize: chunkContent.length,
                            startPosition: position,
                        },
                    });
                }
            }
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

    async readTextileFiles(dir: string): Promise<string[]> {
        let results: string[] = [];
        const list = Deno.readDirSync(dir);

        for (const file of list) {
            const fullPath = path.resolve(dir, file.name);
            if (file.isDirectory) {
                results = results.concat(
                    await this.readTextileFiles(fullPath),
                );
            } else if (path.extname(file.name) === ".md") {
                const content = await Deno.readTextFile(fullPath);
                results.push(content);
            }
        }
        return results;
    }

    async appendToFile(filePath: string, content: string): Promise<void> {
        try {
            await Deno.writeTextFile(filePath, content, {
                append: false,
            });
        } catch (error) {
            console.error(`Error appending content to "${filePath}":`, error);
            throw error;
        }
    }
}
