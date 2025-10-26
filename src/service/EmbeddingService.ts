import { FeatureExtractionPipeline, pipeline } from "@xenova/transformers";
import { ConfigService } from "./ConfigService.ts";
import { IOCManualRegistration } from "../ioc/decorator.ts";

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

    async embed(text: string): Promise<number[][]> {
        const result = await this.pipe(text, {
            pooling: "mean",
            normalize: true,
        });
        return result.tolist();
    }
}
