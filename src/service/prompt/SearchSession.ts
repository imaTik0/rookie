/**
 * Session-scoped guard around the `search_knowledge_base` tool.
 *
 * Observed failure mode (small local models especially): the research agent
 * re-issues near-identical queries, receives the identical chunks, serialises
 * them into context again, and loops — burning the token budget on repeats.
 *
 * The guard always executes the search (retrieval is cheap next to LLM calls),
 * but de-duplicates at the chunk level: content already returned earlier in the
 * session is replaced by a short preview stub, and when a query yields nothing
 * new the agent gets an explicit steer toward different keywords, the file
 * tools, or concluding. Chunks are keyed by their vector-store point id.
 *
 * One session per agent phase — the knowledge base is immutable within a run,
 * so a chunk once shown is never stale.
 */
import * as types from "../../types/index.ts";
import { tokenOverlap } from "../../feedback/fragmentVerify.ts";
import { emitLog, ProgressCallback } from "./helpers.ts";
import { SearchToolArgs } from "./types.ts";

/** Token-overlap ratio above which two queries are considered near-identical. */
const REPEAT_QUERY_THRESHOLD = 0.8;
/** Preview length kept for chunks the agent has already seen. */
const SEEN_PREVIEW_CHARS = 160;

export interface SearchSessionOptions {
    /** Executes the actual hybrid search for this session's collection/limit. */
    search: (query: string) => Promise<types.vector.SearchResult<types.file.FileShard>[]>;
    /** Max characters of chunk content serialised into a tool result. */
    maxResultChars: number;
    /** Progress-log prefix, e.g. `Agent searching`. */
    logLabel: string;
    onProgress?: ProgressCallback;
}

/** Create a guarded `search_knowledge_base` handler with per-session memory. */
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
