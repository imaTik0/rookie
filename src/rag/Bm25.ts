import type { SparseVector } from "../types/vector.ts";

export interface Bm25Params {
    k1: number;
    b: number;
    avgLen: number;
}

export const DEFAULT_BM25_PARAMS: Bm25Params = { k1: 1.5, b: 0.75, avgLen: 256 };

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

export function tokenId(token: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < token.length; i++) {
        hash ^= token.charCodeAt(i);
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

export function encodeQuery(text: string): SparseVector {
    const counts = countTerms(tokenize(text));
    const indices = Array.from(counts.keys());
    const values = indices.map(() => 1.0);
    return { indices, values };
}
