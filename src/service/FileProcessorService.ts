import { v4 as uuidv4 } from "uuid";
import { EmbeddingService } from "./EmbeddingService.ts";
import * as types from "../types/index.ts";
import { VectorCollectionFactory } from "../db/vectordb/VectorCollectionFactory.ts";
import { Buffer } from "node:buffer";

export class FileProcessorService {
    constructor(
        private embeddingService: EmbeddingService,
        private vectorCollectionFactory: VectorCollectionFactory,
    ) {}

    async processAndStore(
        files: types.file.FileShard[],
        vectorCollectionName: string,
    ): Promise<void> {
        const points: types.vector.VectorPoint<types.file.FileShard>[] = await Promise.all(
            files.map(async (file) => {
                const denseResult = await this.embeddingService.embed(file.content);
                const sparseResult = this.embeddingService.sparseEmbed(file.content);

                if (!denseResult || denseResult.length === 0) {
                    throw new Error(
                        `Embedding failed for file with metadata: ${JSON.stringify(file.metadata)}`,
                    );
                }

                const point: types.vector.VectorPoint<types.file.FileShard> = {
                    id: uuidv4() as types.core.VectorPointId,
                    vector: {
                        "": denseResult[0],
                        "sparse": sparseResult,
                    },
                    payload: file,
                };
                return point;
            }),
        );

        const vectorCollection = await this.vectorCollectionFactory
            .createCollection<types.file.FileShard>(vectorCollectionName);
        await vectorCollection.upsertPoints(points);
    }

    sanitizeWhiteCharsInText(text: string | Buffer): string {
        return (Buffer.isBuffer(text) ? text.toString() : text).replace(/\u00A0/g, " ").replace(
            /[ \t]+/g,
            " ",
        ).replace(/&nbsp;/g, " ");
    }
}
