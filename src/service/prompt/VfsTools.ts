/**
 * Virtual-file-system tool handlers for the research/verification agents.
 *
 * Exposes the project's documentation files to the LLM as callable tools
 * (list/read/head/tail/grep, cross-file grep, structural outline, section read,
 * and OpenAPI endpoint lookup). Extracted from PromptService — pure file logic,
 * no LLM or network.
 */
import type { DocFile } from "../../types/file.ts";
import { ConfigService } from "../ConfigService.ts";
import { emitLog, ProgressCallback } from "./helpers.ts";

type OpenApiEndpoint = { method: string; path: string; summary?: string; definition: unknown };
type OpenApiIndex = Map<string, OpenApiEndpoint[]>;

export class VfsTools {
    constructor(private configService: ConfigService) {}

    // Memoize by array reference: the same `files` array is passed to every
    // createHandlers call within a single request, so parsing happens once.
    private readonly openApiIndexCache = new WeakMap<object[], OpenApiIndex>();

    createHandlers(files: DocFile[], onProgress?: ProgressCallback) {
        // Pre-build a parsed OpenAPI index for get_endpoint lookups.
        const openApiIndex = this.buildOpenApiIndex(files);

        return {
            list_files: () => {
                emitLog(onProgress, "Agent listing VFS files.");
                return Promise.resolve(
                    files.map((f) => f.metadata.filename).join("\n") || "No files available.",
                );
            },
            // deno-lint-ignore no-explicit-any
            read_file: (_id: string, args: any) => {
                emitLog(onProgress, `Agent reading file: ${args.filename}`);
                const file = files.find((f) => f.metadata.filename === args.filename);
                if (!file) return Promise.resolve(`File not found: ${args.filename}`);
                const content = new TextDecoder().decode(file.buffer);
                // Cap whole-file reads: a large doc can be 200k+ tokens and would
                // blow the model context in a single tool result. Return a head
                // slice and steer the agent toward targeted tools for the rest.
                const cap = this.configService.values.limits.maxFileReadChars;
                if (content.length > cap) {
                    const totalLines = content.split("\n").length;
                    return Promise.resolve(
                        content.slice(0, cap) +
                            `\n\n…[truncated: showing first ${cap} of ${content.length} chars, ` +
                            `${totalLines} lines total]…\n` +
                            `This file is large. Use outline_file() to see its structure, ` +
                            `read_section(heading) to read a specific section, ` +
                            `grep_corpus(pattern) for cross-file search, ` +
                            `or search_knowledge_base(query) for semantic lookup.`,
                    );
                }
                return Promise.resolve(content);
            },
            // deno-lint-ignore no-explicit-any
            head_file: (_id: string, args: any) => {
                const linesCount = args.lines || 50;
                emitLog(
                    onProgress,
                    `Agent reading head of file: ${args.filename} (${linesCount} lines)`,
                );
                const file = files.find((f) => f.metadata.filename === args.filename);
                if (!file) return Promise.resolve(`File not found: ${args.filename}`);
                const content = new TextDecoder().decode(file.buffer);
                return Promise.resolve(content.split("\n").slice(0, linesCount).join("\n"));
            },
            // deno-lint-ignore no-explicit-any
            tail_file: (_id: string, args: any) => {
                const linesCount = args.lines || 50;
                emitLog(
                    onProgress,
                    `Agent reading tail of file: ${args.filename} (${linesCount} lines)`,
                );
                const file = files.find((f) => f.metadata.filename === args.filename);
                if (!file) return Promise.resolve(`File not found: ${args.filename}`);
                const content = new TextDecoder().decode(file.buffer);
                const lines = content.split("\n");
                return Promise.resolve(
                    lines.slice(Math.max(0, lines.length - linesCount)).join("\n"),
                );
            },
            // deno-lint-ignore no-explicit-any
            grep_file: (_id: string, args: any) => {
                emitLog(
                    onProgress,
                    `Agent grepping file: ${args.filename} for pattern: ${args.pattern}`,
                );
                const file = files.find((f) => f.metadata.filename === args.filename);
                if (!file) return Promise.resolve(`File not found: ${args.filename}`);
                const content = new TextDecoder().decode(file.buffer);
                const lines = content.split("\n");
                let result = "";
                let regex: RegExp;
                try {
                    regex = new RegExp(args.pattern, "i");
                } catch {
                    return Promise.resolve(`Invalid regex pattern: ${args.pattern}`);
                }
                for (let i = 0; i < lines.length; i++) {
                    if (regex.test(lines[i])) {
                        result += `[Line ${i + 1}]: ${lines[i]}\n`;
                    }
                }
                return Promise.resolve(
                    result || `No matches found for ${args.pattern} in ${args.filename}`,
                );
            },

            // ── New VFS tools ─────────────────────────────────────────────────

            // deno-lint-ignore no-explicit-any
            grep_corpus: (_id: string, args: any) => {
                const pattern = args.pattern as string;
                const contextLines = Math.min(Number(args.context_lines) || 2, 10);
                emitLog(onProgress, `Agent grepping corpus for: ${pattern}`);
                let regex: RegExp;
                try {
                    regex = new RegExp(pattern, "i");
                } catch {
                    return Promise.resolve(`Invalid regex pattern: ${pattern}`);
                }
                const results: string[] = [];
                for (const f of files) {
                    const content = new TextDecoder().decode(f.buffer);
                    const lines = content.split("\n");
                    for (let i = 0; i < lines.length; i++) {
                        if (regex.test(lines[i])) {
                            const from = Math.max(0, i - contextLines);
                            const to = Math.min(lines.length - 1, i + contextLines);
                            results.push(`[${f.metadata.filename}:${i + 1}]`);
                            for (let j = from; j <= to; j++) {
                                results.push(`${j === i ? ">" : " "} ${j + 1}: ${lines[j]}`);
                            }
                            results.push("");
                            if (results.length > 500) {
                                results.push("…[truncated — too many matches]");
                                break;
                            }
                        }
                    }
                    if (results.length > 500) break;
                }
                return Promise.resolve(results.join("\n") || `No matches for pattern: ${pattern}`);
            },

            // deno-lint-ignore no-explicit-any
            outline_file: (_id: string, args: any) => {
                emitLog(onProgress, `Agent outlining file: ${args.filename}`);
                const file = files.find((f) => f.metadata.filename === args.filename);
                if (!file) return Promise.resolve(`File not found: ${args.filename}`);
                const content = new TextDecoder().decode(file.buffer);

                // OpenAPI JSON: list paths + methods
                if (
                    args.filename.endsWith(".json") || args.filename.endsWith(".yaml") ||
                    args.filename.endsWith(".yml")
                ) {
                    if (openApiIndex.has(args.filename)) {
                        const endpoints = openApiIndex.get(args.filename)!;
                        return Promise.resolve(
                            `OpenAPI spec — ${endpoints.length} endpoints:\n` +
                                endpoints.map((e) =>
                                    `  ${e.method.toUpperCase()} ${e.path}${
                                        e.summary ? ` — ${e.summary}` : ""
                                    }`
                                ).join("\n"),
                        );
                    }
                }

                // Markdown: headings with line numbers
                const lines = content.split("\n");
                const headings: string[] = [];
                for (let i = 0; i < lines.length; i++) {
                    const m = lines[i].match(/^(#{1,6})\s+(.*)/);
                    if (m) {
                        headings.push(`L${i + 1} ${"  ".repeat(m[1].length - 1)}${m[1]} ${m[2]}`);
                    }
                }
                return Promise.resolve(
                    headings.length > 0
                        ? headings.join("\n")
                        : `No headings found in ${args.filename}. File has ${lines.length} lines.`,
                );
            },

            // deno-lint-ignore no-explicit-any
            read_section: (_id: string, args: any) => {
                const heading = String(args.heading || "").toLowerCase();
                emitLog(
                    onProgress,
                    `Agent reading section "${args.heading}" from ${args.filename}`,
                );
                const file = files.find((f) => f.metadata.filename === args.filename);
                if (!file) return Promise.resolve(`File not found: ${args.filename}`);
                const content = new TextDecoder().decode(file.buffer);
                const lines = content.split("\n");

                // Find the first heading that matches (case-insensitive partial match).
                let startIdx = -1;
                let headingLevel = 0;
                for (let i = 0; i < lines.length; i++) {
                    const m = lines[i].match(/^(#{1,6})\s+(.*)/);
                    if (m && m[2].toLowerCase().includes(heading)) {
                        startIdx = i;
                        headingLevel = m[1].length;
                        break;
                    }
                }
                if (startIdx === -1) {
                    return Promise.resolve(
                        `No heading matching "${args.heading}" found in ${args.filename}.`,
                    );
                }

                // Collect lines until the next heading of same or higher level.
                const section: string[] = [lines[startIdx]];
                for (let i = startIdx + 1; i < lines.length; i++) {
                    const m = lines[i].match(/^(#{1,6})\s+/);
                    if (m && m[1].length <= headingLevel) break;
                    section.push(lines[i]);
                }
                const result = section.join("\n");
                const cap = this.configService.values.limits.maxFileReadChars;
                return Promise.resolve(
                    result.length > cap
                        ? result.slice(0, cap) + `\n…[section truncated at ${cap} chars]`
                        : result,
                );
            },

            // deno-lint-ignore no-explicit-any
            get_endpoint: (_id: string, args: any) => {
                const targetPath = String(args.path || "").toLowerCase();
                const targetMethod = args.method ? String(args.method).toUpperCase() : null;
                emitLog(
                    onProgress,
                    `Agent looking up endpoint: ${targetMethod || "*"} ${args.path}`,
                );

                const hits: string[] = [];
                for (const [filename, endpoints] of openApiIndex) {
                    for (const ep of endpoints) {
                        if (!ep.path.toLowerCase().includes(targetPath)) continue;
                        if (targetMethod && ep.method.toUpperCase() !== targetMethod) continue;
                        hits.push(
                            `**${ep.method.toUpperCase()} ${ep.path}** (${filename})` +
                                (ep.summary ? `\n${ep.summary}` : "") +
                                "\n```json\n" +
                                JSON.stringify(ep.definition, null, 2).slice(0, 2000) + "\n```",
                        );
                    }
                }
                return Promise.resolve(
                    hits.length > 0
                        ? hits.join("\n\n---\n\n")
                        : `No endpoint matching "${
                            args.method ?? "*"
                        } ${args.path}" found in OpenAPI specs.`,
                );
            },
        };
    }

    /** Build a path→endpoints index from all OpenAPI JSON files in the project. */
    private buildOpenApiIndex(files: DocFile[]): OpenApiIndex {
        const cached = this.openApiIndexCache.get(files);
        if (cached) return cached;
        const index: OpenApiIndex = new Map();
        for (const file of files) {
            const fn: string = file.metadata.filename;
            if (!fn.endsWith(".json") && !fn.endsWith(".yaml") && !fn.endsWith(".yml")) continue;
            try {
                const content = new TextDecoder().decode(file.buffer);
                if (!content.includes('"paths"') && !content.includes("paths:")) continue;
                const obj = JSON.parse(content) as Record<string, unknown>;
                if (typeof obj !== "object" || !obj.paths) continue;
                const endpoints: OpenApiEndpoint[] = [];
                for (
                    const [apiPath, methods] of Object.entries(
                        obj.paths as Record<string, Record<string, unknown>>,
                    )
                ) {
                    for (const [method, def] of Object.entries(methods)) {
                        if (["parameters", "summary", "description"].includes(method)) continue;
                        const d = def as Record<string, unknown>;
                        endpoints.push({
                            method,
                            path: apiPath,
                            summary: d?.summary as string | undefined,
                            definition: def,
                        });
                    }
                }
                if (endpoints.length > 0) index.set(fn, endpoints);
            } catch { /* not valid JSON/OpenAPI */ }
        }
        this.openApiIndexCache.set(files, index);
        return index;
    }
}
