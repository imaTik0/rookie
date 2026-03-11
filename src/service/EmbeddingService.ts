import { FeatureExtractionPipeline, pipeline } from "@xenova/transformers";
import { ConfigService } from "./ConfigService.ts";
import { IOCManualRegistration } from "../ioc/decorator.ts";
import * as types from "../types/index.ts";

@IOCManualRegistration
export class EmbeddingService {
    private static instance: EmbeddingService | null = null;
    private pipe: FeatureExtractionPipeline;

    private constructor(pipe: FeatureExtractionPipeline) {
        this.pipe = pipe;
    }

    static async init(configService: ConfigService): Promise<EmbeddingService> {
        if (!this.instance) {
            const modelName = configService.values.embeddings.embeddingModel;
            const extractor = await pipeline("feature-extraction", modelName);
            this.instance = new EmbeddingService(
                extractor as FeatureExtractionPipeline,
            );
        }
        return this.instance;
    }

    async embed(text: string): Promise<types.vector.DenseVector[]> {
        const result = await this.pipe(text, {
            pooling: "mean",
            normalize: true,
        });
        return result.tolist();
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
