import OpenAI from "@openai/openai";
import { Logger } from "../../Logger.ts";
import { ConfigService } from "../ConfigService.ts";
import { EmbeddingService } from "../EmbeddingService.ts";
import { VectorCollectionFactory } from "../../db/vectordb/VectorCollectionFactory.ts";
import * as types from "../../types/index.ts";
import { LlmComplete, rerankResults } from "../../rag/Reranker.ts";

export class RagSearch {
    constructor(
        private openai: OpenAI,
        private embeddingService: EmbeddingService,
        private vectorCollectionFactory: VectorCollectionFactory,
        private configService: ConfigService,
        private logger: Logger,
    ) {}

    async search(
        collectionName: string,
        query: string,
        limit: number = this.configService.values.limits.defaultSearchLimit,
    ): Promise<types.vector.SearchResult<types.file.FileShard>[]> {
        try {
            this.logger.log(
                `RAG search — collection: "${collectionName}" query: "${query.slice(0, 120)}"`,
            );
            const collection = await this.vectorCollectionFactory.createCollection<
                types.file.FileShard
            >(collectionName);

            const dense = await this.embeddingService.embed(query);
            const sparse = this.embeddingService.sparseEmbed(query);

            const rerankCfg = this.configService.values.reranker;
            const fetchLimit = rerankCfg.mode === "off" ? limit : Math.max(limit, rerankCfg.topN);

            const raw = await collection.searchHybrid(
                dense[0] as types.vector.DenseVector,
                sparse,
                fetchLimit,
            );
            return await this.rerank(query, raw, limit);
        } catch (error) {
            const err = error as types.vector.QdrantError;
            const errorData = err?.data?.status?.error || err?.message || String(error);
            this.logger.error(
                `RAG search failed for collection "${collectionName}": ${
                    JSON.stringify(errorData).substring(0, 300)
                }`,
            );
            return [];
        }
    }

    async rerank(
        query: string,
        results: types.vector.SearchResult<types.file.FileShard>[],
        limit: number,
    ): Promise<types.vector.SearchResult<types.file.FileShard>[]> {
        const cfg = this.configService.values.reranker;
        if (cfg.mode === "off") return results.slice(0, limit);
        return await rerankResults(
            query,
            results,
            limit,
            (r) => r.payload?.content || "",
            cfg,
            {
                llmComplete: cfg.mode === "llm" ? this.buildLlmComplete() : undefined,
                logger: this.logger,
            },
        );
    }

    formatResults(results: types.vector.SearchResult<types.file.FileShard>[]): string {
        return results
            .map((res, i) =>
                `--- DOCUMENT ${i + 1} (Score: ${res.score}) ---\n${
                    (res.payload?.content || "No content").substring(
                        0,
                        this.configService.values.limits.maxResultChars,
                    )
                }\n`
            )
            .join("\n");
    }

    async rankAndFilterDocs(content: string, query: string, maxChars: number): Promise<string> {
        if (content.length <= maxChars) return content;

        const chunks = content.split(/--- DOCUMENT \d+[^\n]*---/).filter((c) =>
            c.trim().length > 0
        );
        if (chunks.length <= 1) {
            const fallbackChunks = content.split("\n\n").filter((c) => c.trim().length > 0);
            if (fallbackChunks.length > 1) {
                return this.rankAndFilterDocsByChunks(fallbackChunks, query, maxChars);
            }
            return content.substring(0, maxChars);
        }

        return this.rankAndFilterDocsByChunks(chunks, query, maxChars);
    }

    private async rankAndFilterDocsByChunks(
        chunks: string[],
        query: string,
        maxChars: number,
    ): Promise<string> {
        try {
            const inputs = [query, ...chunks.map((c) => c.substring(0, 3000))];
            const vectors = await this.embeddingService.embedBatch(inputs);
            const queryVector = vectors[0];

            const scoredChunks = chunks.map((content, i) => ({
                content,
                score: this.cosineSimilarity(queryVector, vectors[i + 1] as number[]),
            }));

            scoredChunks.sort((a, b) => b.score - a.score);

            let result = "";
            for (const sc of scoredChunks) {
                if ((result.length + sc.content.length) > maxChars) break;
                result += (result ? "\n\n" : "") + sc.content;
            }

            return result || chunks[0].substring(0, maxChars);
        } catch (error) {
            this.logger.error(error, "Error in smart truncation");
            return chunks.join("\n\n").substring(0, maxChars);
        }
    }

    private cosineSimilarity(vecA: number[], vecB: number[]): number {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    private buildLlmComplete(): LlmComplete {
        return async (system, user) => {
            const llm = this.configService.values.llm;
            const resp = await this.openai.chat.completions.create({
                model: this.configService.values.openAI.modelName,
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
                temperature: llm.temperature,
                ...(llm.seed !== undefined ? { seed: llm.seed } : {}),
                // deno-lint-ignore no-explicit-any
            } as any);
            return resp.choices[0]?.message?.content || "";
        };
    }
}
