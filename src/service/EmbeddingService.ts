import OpenAI from "@openai/openai";
import { Injectable, InjectParam } from "../ioc/decorator.ts";
import { ConfigService } from "./ConfigService.ts";
import * as types from "../types/index.ts";
import { Bm25Params, encodeDocument, encodeQuery } from "../rag/Bm25.ts";
import { withRetry } from "../llm/retry.ts";

@Injectable()
export class EmbeddingService {
    private modelName: string;
    private dimensions: number;
    private bm25Params: Bm25Params;

    constructor(
        // Distinct from the chat `openai` instance (same type) — resolve by name.
        @InjectParam("openaiEmbedding") private openaiEmbedding: OpenAI,
        private configService: ConfigService,
    ) {
        this.modelName = configService.values.embeddings.embeddingModel;
        this.dimensions = configService.values.embeddings.vectorSize;
        this.bm25Params = configService.values.sparse;
    }

    /** Embed a single text. Returns a length-1 array for backward compatibility. */
    async embed(text: string): Promise<types.vector.DenseVector[]> {
        return this.embedBatch([text]);
    }

    /** Embed many texts in a single request (the embeddings API accepts arrays). */
    async embedBatch(texts: string[]): Promise<types.vector.DenseVector[]> {
        if (texts.length === 0) return [];
        const payload: any = {
            model: this.modelName,
            input: texts,
        };
        // Not all local models support overriding dimensions
        if (this.dimensions && this.dimensions > 0) {
            payload.dimensions = this.dimensions;
        }

        const response = await withRetry(
            () => this.openaiEmbedding.embeddings.create(payload),
            {
                retries: this.configService.values.llm.maxRetries,
                baseDelayMs: this.configService.values.llm.retryBaseMs,
                label: "embeddings.create",
            },
        );
        return response.data.map((d: any) => d.embedding);
    }

    /** Sparse encoder for QUERIES (presence-only; IDF applied server-side by Qdrant). */
    sparseEmbed(text: string): types.vector.SparseVector {
        return encodeQuery(text);
    }

    /** Sparse encoder for DOCUMENTS at index time (BM25 term-frequency saturation). */
    sparseEmbedDocument(text: string): types.vector.SparseVector {
        return encodeDocument(text, this.bm25Params);
    }
}
