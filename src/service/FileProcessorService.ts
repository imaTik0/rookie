import { Injectable } from "../ioc/decorator.ts";
import { v4 as uuidv4 } from "uuid";
import * as types from "../types/index.ts";
import { VectorCollectionFactory } from "../db/vectordb/VectorCollectionFactory.ts";
import { Buffer } from "node:buffer";
import { EmbeddingService } from "./EmbeddingService.ts";

@Injectable()
export class FileProcessorService {
    constructor(
        private vectorCollectionFactory: VectorCollectionFactory,
        private embeddingService: EmbeddingService,
    ) {}

    async processAndStore(
        files: types.file.FileShard[],
        vectorCollectionName: string,
    ): Promise<void> {
        const BATCH_SIZE = 50;
        const vectorCollection = await this.vectorCollectionFactory
            .createCollection<types.file.FileShard>(vectorCollectionName);

        for (let i = 0; i < files.length; i += BATCH_SIZE) {
            const batch = files.slice(i, i + BATCH_SIZE);

            const denseVectors = await this.embeddingService.embedBatch(
                batch.map((f) => f.content),
            );

            const points: types.vector.VectorPoint<types.file.FileShard>[] = batch.map(
                (file, j) => ({
                    id: uuidv4() as types.core.VectorPointId,
                    vector: {
                        "dense": denseVectors[j],
                        "sparse": this.embeddingService.sparseEmbedDocument(file.content),
                    },
                    payload: file,
                }),
            );

            await vectorCollection.upsertPoints(points);
        }
    }

    sanitizeWhiteCharsInText(text: string | Buffer): string {
        return (Buffer.isBuffer(text) ? text.toString() : text).replace(/\u00A0/g, " ").replace(
            /[ \t]+/g,
            " ",
        ).replace(/&nbsp;/g, " ");
    }
}
