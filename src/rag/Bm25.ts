/**
 * Self-contained BM25 sparse encoder.
 *
 * Replaces the previous unweighted hashed term-frequency vector. This produces
 * sparse vectors whose VALUES carry the BM25 term-frequency saturation
 * (k1 / b / document-length normalisation), while the IDF component is applied
 * by Qdrant at query time via the sparse-vector `modifier: "idf"` setting
 * (see VectorCollectionFactory). Token ids are a stable hash of each token, so
 * the same word maps to the same sparse dimension across every document — which
 * is what lets Qdrant compute IDF from collection statistics.
 *
 * This mirrors the approach used by FastEmbed's `Bm25`: documents get the
 * saturated TF weight; queries are encoded as presence (value 1.0) and rely on
 * the server-side IDF. Pure and deterministic — no model or network needed.
 */
import type { SparseVector } from "../types/vector.ts";

export interface Bm25Params {
    k1: number;
    b: number;
    avgLen: number;
}

export const DEFAULT_BM25_PARAMS: Bm25Params = { k1: 1.5, b: 0.75, avgLen: 256 };

// Compact English stopword list. Kept small on purpose: technical docs are
// keyword-dense and over-aggressive stopping hurts recall.
const STOPWORDS = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "if",
    "then",
    "else",
    "for",
    "of",
    "to",
    "in",
    "on",
    "at",
    "by",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "this",
    "that",
    "these",
    "those",
    "it",
    "its",
    "as",
    "from",
    "with",
    "you",
    "your",
    "we",
    "our",
    "they",
    "their",
    "can",
    "will",
    "would",
    "should",
]);

/** Deterministic, non-negative 32-bit token id (FNV-1a). Stays within Qdrant's u32 range. */
export function tokenId(token: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < token.length; i++) {
        hash ^= token.charCodeAt(i);
        // hash *= 16777619, kept in 32-bit space
        hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>>
            0;
    }
    return hash >>> 0;
}

export function tokenize(text: string, useStopwords = true): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((w) => w.length > 1 && (!useStopwords || !STOPWORDS.has(w)));
}

function countTerms(tokens: string[]): Map<number, number> {
    const counts = new Map<number, number>();
    for (const tok of tokens) {
        const id = tokenId(tok);
        counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
}

/**
 * Encode a DOCUMENT: BM25 term-frequency saturation per unique token.
 *   weight = tf * (k1 + 1) / (tf + k1 * (1 - b + b * docLen / avgLen))
 */
export function encodeDocument(
    text: string,
    params: Bm25Params = DEFAULT_BM25_PARAMS,
): SparseVector {
    const tokens = tokenize(text);
    const docLen = tokens.length;
    const counts = countTerms(tokens);
    const indices: number[] = [];
    const values: number[] = [];

    const norm = params.k1 * (1 - params.b + (params.b * docLen) / (params.avgLen || 1));
    for (const [id, tf] of counts) {
        const weight = (tf * (params.k1 + 1)) / (tf + norm);
        indices.push(id);
        values.push(weight);
    }
    return { indices, values };
}

/**
 * Encode a QUERY: presence-only (value 1.0). The IDF weighting and the
 * document-side saturation make this sufficient and avoids double-counting.
 */
export function encodeQuery(text: string): SparseVector {
    const counts = countTerms(tokenize(text));
    const indices = Array.from(counts.keys());
    const values = indices.map(() => 1.0);
    return { indices, values };
}
