import * as types from "../../types/index.ts";
import { tokenOverlap } from "../../feedback/fragmentVerify.ts";
import { emitLog, ProgressCallback } from "./helpers.ts";
import { SearchToolArgs } from "./types.ts";

const REPEAT_QUERY_THRESHOLD = 0.8;
const SEEN_PREVIEW_CHARS = 160;

export interface SearchSessionOptions {
    search: (query: string) => Promise<types.vector.SearchResult<types.file.FileShard>[]>;
    maxResultChars: number;
    logLabel: string;
    onProgress?: ProgressCallback;
}

export function createSearchSession(opts: SearchSessionOptions) {
    const seenChunkIds = new Set<string>();
    const pastQueries: string[] = [];

    // deno-lint-ignore no-explicit-any
    const handler = async (_id: string, rawArgs: any): Promise<string> => {
        const { query } = rawArgs as SearchToolArgs;
        emitLog(opts.onProgress, `${opts.logLabel}: "${query}"`);

        const repeatedQuery = pastQueries.find(
            (q) => tokenOverlap(q, query) >= REPEAT_QUERY_THRESHOLD,
        );
        pastQueries.push(query);

        const results = await opts.search(query);
        if (results.length === 0) {
            return `No results for this query. Try different keywords (endpoint paths, ` +
                `parameter names, error text), or inspect files directly with ` +
                `grep_corpus / outline_file / read_section.`;
        }

        const fresh: unknown[] = [];
        const stubs: unknown[] = [];
        for (const r of results) {
            const key = String(r.id);
            const content = r.payload?.content || "";
            if (seenChunkIds.has(key)) {
                stubs.push({
                    id: r.id,
                    score: r.score,
                    fileName: r.payload?.metadata?.fileName,
                    section: r.payload?.metadata?.section,
                    preview: content.substring(0, SEEN_PREVIEW_CHARS),
                    note:
                        "content omitted — this chunk was already returned earlier in this session",
                });
            } else {
                seenChunkIds.add(key);
                fresh.push({
                    ...r,
                    payload: r.payload
                        ? { ...r.payload, content: content.substring(0, opts.maxResultChars) }
                        : r.payload,
                });
            }
        }

        const status = `Found ${results.length} result(s): ${fresh.length} new, ` +
            `${stubs.length} previously retrieved.`;
        const body = JSON.stringify([...fresh, ...stubs]);

        if (fresh.length === 0) {
            const repeatNote = repeatedQuery
                ? ` This query is nearly identical to an earlier one ("${repeatedQuery}").`
                : "";
            return `${status}${repeatNote} NO NEW information — everything matching this query ` +
                `is already in your context. Do NOT search for this again. Either use ` +
                `substantially different keywords, inspect files directly ` +
                `(grep_corpus / outline_file / read_section / get_endpoint), or proceed ` +
                `with the information you already have.\n${body}`;
        }

        return `${status}\n${body}`;
    };

    return { handler };
}
