import OpenAI from "@openai/openai";
import { ConfigService } from "./ConfigService.ts";
import * as types from "../types/index.ts";

export class EmbeddingService {
    private modelName: string;
    private dimensions: number;

    constructor(
        private openaiEmbedding: OpenAI,
        private configService: ConfigService,
    ) {
        this.modelName = configService.values.embeddings.embeddingModel;
        this.dimensions = configService.values.embeddings.vectorSize;
    }

    async embed(text: string): Promise<types.vector.DenseVector[]> {
        const payload: any = {
            model: this.modelName,
            input: text,
        };
        // Not all local models support overriding dimensions
        if (this.dimensions && this.dimensions > 0) {
            payload.dimensions = this.dimensions;
        }

        const response = await this.openaiEmbedding.embeddings.create(payload);
        return response.data.map((d: any) => d.embedding);
    }

    sparseEmbed(text: string): types.vector.SparseVector {
        const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
        const counts: Record<number, number> = {};
        for (const word of words) {
            let hash = 0;
            for (let i = 0; i < word.length; i++) {
                hash = ((hash << 5) - hash) + word.charCodeAt(i);
                hash |= 0;
            }
            const index = Math.abs(hash);
            counts[index] = (counts[index] || 0) + 1;
        }

        const indices = Object.keys(counts).map(Number);
        const values = indices.map((idx) => counts[idx]);
        return { indices, values };
    }
}
