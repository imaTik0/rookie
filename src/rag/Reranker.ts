/**
 * Optional reranking of retrieved chunks, applied AFTER hybrid (dense+BM25)
 * retrieval and BEFORE the results are handed to the LLM. A reranker improves
 * precision@k — directly addressing the "noise / too much irrelevant doc"
 * failure mode reported in the RAG literature.
 *
 * Three modes (config `reranker.mode`):
 *  - "off" : no-op (just truncate to `limit`). Default — keeps small setups fast.
 *  - "llm" : listwise rerank using the SAME chat model. Works with any backend
 *            (incl. small local models). Falls back to original order on any
 *            parse failure, so it can never make results worse than retrieval.
 *  - "api" : call a Jina/Cohere/TEI-compatible `/rerank` endpoint (cross-encoder).
 *
 * Generic over the result type; only needs a way to read each item's text.
 */
import { Logger } from "../Logger.ts";

export interface RerankConfig {
    mode: "off" | "llm" | "api";
    topN: number;
    model?: string;
    baseURL?: string;
    apiKey?: string;
}

export type LlmComplete = (system: string, user: string) => Promise<string>;

interface RerankDeps {
    llmComplete?: LlmComplete;
    logger?: Logger;
}

const MAX_DOC_CHARS = 600;

export async function rerankResults<T>(
    query: string,
    results: T[],
    limit: number,
    getText: (item: T) => string,
    cfg: RerankConfig,
    deps: RerankDeps = {},
): Promise<T[]> {
    if (cfg.mode === "off" || results.length <= 1) {
        return results.slice(0, limit);
    }

    const candidates = results.slice(0, Math.max(cfg.topN, limit));
    try {
        const order = cfg.mode === "api"
            ? await rerankViaApi(query, candidates, getText, cfg)
            : await rerankViaLlm(query, candidates, getText, deps.llmComplete);

        if (!order || order.length === 0) return results.slice(0, limit);
        const reordered = order
            .filter((i) => i >= 0 && i < candidates.length)
            .map((i) => candidates[i]);
        // Append any candidates the model omitted, preserving their original order.
        for (let i = 0; i < candidates.length; i++) {
            if (!order.includes(i)) reordered.push(candidates[i]);
        }
        return reordered.slice(0, limit);
    } catch (err) {
        deps.logger?.error(err, "Rerank failed; falling back to retrieval order");
        return results.slice(0, limit);
    }
}

async function rerankViaLlm<T>(
    query: string,
    candidates: T[],
    getText: (item: T) => string,
    llmComplete?: LlmComplete,
): Promise<number[] | null> {
    if (!llmComplete) return null;

    const list = candidates
        .map((c, i) => `[${i}] ${getText(c).replace(/\s+/g, " ").slice(0, MAX_DOC_CHARS)}`)
        .join("\n");

    const system =
        "You are a search reranker. Given a query and numbered documents, return the document " +
        "indices ordered from most to least relevant to the query. Respond with ONLY a JSON " +
        'object: {"ranking": [<indices>]}. Include every index exactly once.';
    const user = `### QUERY\n${query}\n\n### DOCUMENTS\n${list}`;

    const raw = await llmComplete(system, user);
    return parseRanking(raw, candidates.length);
}

function parseRanking(raw: string, n: number): number[] | null {
    // Tolerate code fences / surrounding prose by extracting the first JSON object or array.
    const objMatch = raw.match(/\{[\s\S]*\}/);
    const arrMatch = raw.match(/\[[\s\S]*\]/);
    const text = objMatch?.[0] || arrMatch?.[0];
    if (!text) return null;
    try {
        const parsed = JSON.parse(text);
        const ranking: unknown = Array.isArray(parsed) ? parsed : parsed.ranking;
        if (!Array.isArray(ranking)) return null;
        const ints = ranking.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x >= 0 && x < n);
        return ints.length > 0 ? ints : null;
    } catch {
        return null;
    }
}

async function rerankViaApi<T>(
    query: string,
    candidates: T[],
    getText: (item: T) => string,
    cfg: RerankConfig,
): Promise<number[] | null> {
    if (!cfg.baseURL) return null;
    const documents = candidates.map((c) => getText(c).slice(0, 4000));
    const res = await fetch(`${cfg.baseURL.replace(/\/$/, "")}/rerank`, {
        signal: AbortSignal.timeout(10_000),
        method: "POST",
        headers: {
            "content-type": "application/json",
            ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
            query,
            documents,
            model: cfg.model,
            top_n: candidates.length,
        }),
    });
    if (!res.ok) throw new Error(`rerank API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    // Jina/Cohere/TEI style: { results: [{ index, relevance_score }] }
    const arr = data.results || data.data || data;
    if (!Array.isArray(arr)) return null;
    return arr
        .map((r: any) => (typeof r === "number" ? r : r.index))
        .filter((i: number) => Number.isInteger(i));
}
