import { v4 as uuidv4 } from "uuid";
import { EmbeddingService } from "./EmbeddingService.ts";
import { Point } from "../db/vectordb/VectorCollection.ts";
import * as types from "../types/index.ts";
import { VectorCollectionFactory } from "../db/vectordb/VectorCollectionFactory.ts";

export class FileProcessorService {
    constructor(
        private embeddingService: EmbeddingService,
        private vectorCollectionFactory: VectorCollectionFactory,
    ) {}

    async processAndStore(
        files: types.core.FileShard[],
        vectorCollectionName: string,
    ): Promise<void> {
        const points: Point<types.core.FileShard>[] = await Promise.all(
            files.map(async (file) => {
                const embeddingResult = await this.embeddingService.embed(
                    file.content,
                );
                if (!embeddingResult || embeddingResult.length === 0) {
                    throw new Error(
                        `Embedding failed for file with metadata: ${JSON.stringify(file.metadata)}`,
                    );
                }
                const vector = embeddingResult[0];
                const point: Point<types.core.FileShard> = {
                    id: uuidv4() as types.core.VectorPointId,
                    vector,
                    payload: file,
                };
                return point;
            }),
        );
        const vectorCollection = await this.vectorCollectionFactory
            .createCollection<types.core.FileShard>(vectorCollectionName);
        vectorCollection.upsertPoints(points);
    }
}
