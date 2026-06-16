import { Injectable } from "../ioc/decorator.ts";
import * as path from "@std/path";
import * as types from "../types/index.ts";
import * as db from "../db/mongo/Model.ts";
import striptags from "striptags";
import { ConfigService } from "./ConfigService.ts";
import { Logger } from "../Logger.ts";

interface ChunkingOptions {
    chunkSize: number;
    chunkOverlap: number;
}

const SUPPORTED_TEXT_MIMES = [
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
    "application/javascript",
    "text/html",
    "text/xml",
    "application/xml",
    "application/yaml",
    "text/yaml",
    "text/x-yaml",
];

@Injectable()
export class FileHelpers {
    private readonly textDecoder: TextDecoder;

    constructor(private configService: ConfigService, private logger: Logger) {
        this.textDecoder = new TextDecoder("utf-8");
    }

    public chunkDbFile(
        dbFile: db.File,
        options?: ChunkingOptions,
    ): types.file.FileShard[] {
        const opts: ChunkingOptions = options ?? {
            chunkSize: this.configService.values.chunking.chunkSize,
            chunkOverlap: this.configService.values.chunking.chunkOverlap,
        };
        if (!this._isChunkable(dbFile.mimetype)) {
            throw new Error(
                `File is not chunkable (MIME type ${dbFile.mimetype} is not supported text).`,
            );
        }

        let content = this.textDecoder.decode(dbFile.data.buffer);
        // Only strip HTML for actual HTML/XML; stripping Markdown/JSON corrupts
        // content (e.g. `Array<string>`, generics, `<email>` placeholders).
        if (this._isHtmlLike(dbFile.mimetype)) {
            content = striptags(content);
        }

        // OpenAPI/Swagger JSON specs get endpoint-level chunking so each path+method
        // is its own retrievable chunk instead of being split mid-definition.
        if (
            (dbFile.mimetype.startsWith("application/json") || dbFile.filename.endsWith(".json")) &&
            this._isOpenApiJson(content)
        ) {
            const openApiChunks = this._chunkOpenApiJson(
                content,
                dbFile.filename,
                opts,
                dbFile._id,
            );
            if (openApiChunks.length > 0) return openApiChunks;
        }

        return this._chunkText(content, dbFile.filename, opts, dbFile._id);
    }

    public async chunkFileFromPath(
        filePath: string,
        options?: ChunkingOptions,
    ): Promise<types.file.FileShard[]> {
        const opts: ChunkingOptions = options ?? {
            chunkSize: this.configService.values.chunking.chunkSize,
            chunkOverlap: this.configService.values.chunking.chunkOverlap,
        };
        let content = await Deno.readTextFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        if (ext === ".html" || ext === ".htm" || ext === ".xml") {
            content = striptags(content);
        }
        const fileName = path.basename(filePath);
        return this._chunkText(content, fileName, opts);
    }

    private _isHtmlLike(mimetype: string): boolean {
        return mimetype.startsWith("text/html") || mimetype.startsWith("text/xml") ||
            mimetype.startsWith("application/xml");
    }

    public async loadMarkdownContentFromDir(dir: string): Promise<string[]> {
        let results: string[] = [];
        const list = Deno.readDirSync(dir);

        for (const file of list) {
            const fullPath = path.resolve(dir, file.name);
            if (file.isDirectory) {
                results = results.concat(
                    await this.loadMarkdownContentFromDir(fullPath),
                );
            } else if (path.extname(file.name) === ".md") {
                const content = await Deno.readTextFile(fullPath);
                results.push(content);
            }
        }
        return results;
    }

    public async overwriteFile(filePath: string, content: string): Promise<void> {
        try {
            await Deno.writeTextFile(filePath, content, {
                append: false,
            });
        } catch (error) {
            this.logger.error(error, `Error writing content to "${filePath}"`);
            throw error;
        }
    }

    private _isChunkable(mimetype: string): boolean {
        return SUPPORTED_TEXT_MIMES.some((supportedType) => mimetype.startsWith(supportedType));
    }

    /**
     * Structure-aware chunker.
     *
     * Splits on line boundaries while respecting document structure:
     *  - Markdown headings (`#`..`######`) start a new chunk and define the
     *    "section" context, which is prepended to every chunk under them so a
     *    retrieved fragment carries its heading.
     *  - Fenced code blocks (``` ... ```) are never split across chunks.
     *  - Each chunk records its 1-based starting line number for precise
     *    pinpointing in reports.
     * Chunks grow until ~chunkSize, then carry `chunkOverlap` characters of the
     * previous chunk's tail for context continuity.
     */
    private _chunkText(
        content: string,
        fileName: string,
        options: ChunkingOptions,
        fileId?: string,
    ): types.file.FileShard[] {
        if (content.length === 0) return [];

        const lines = content.split("\n");
        const chunks: types.file.FileShard[] = [];
        let chunkNumber = 1;

        let currentSection = "";
        let buf: string[] = [];
        let bufStartLine = 1; // 1-based
        let bufStartPos = 0;
        let posOfLine = 0; // running char offset of the current line
        let inFence = false;

        const bufLength = () => buf.reduce((s, l) => s + l.length + 1, 0);

        const flush = (startLineForNext: number, startPosForNext: number) => {
            const body = buf.join("\n").trim();
            if (body.length > 0) {
                // Prepend the heading context only to continuation chunks; the
                // chunk that opens a section already begins with the heading.
                const needsHeader = currentSection && !body.startsWith(currentSection);
                const chunkContent = needsHeader ? `${currentSection}\n\n${body}` : body;
                chunks.push({
                    content: chunkContent,
                    metadata: {
                        fileId,
                        fileName,
                        chunkId: chunkNumber++,
                        chunkSize: chunkContent.length,
                        startPosition: bufStartPos,
                        lineNumber: bufStartLine,
                        section: currentSection || undefined,
                    },
                });
            }
            buf = [];
            bufStartLine = startLineForNext;
            bufStartPos = startPosForNext;
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNo = i + 1;
            const isFenceToggle = /^\s*```/.test(line);
            const isHeading = !inFence && /^#{1,6}\s+/.test(line);

            // A heading boundary closes the current chunk and updates the section.
            if (isHeading && buf.length > 0) {
                flush(lineNo, posOfLine);
            }
            if (isHeading) {
                currentSection = line.trim();
            }

            if (buf.length === 0) {
                bufStartLine = lineNo;
                bufStartPos = posOfLine;
            }
            buf.push(line);
            if (isFenceToggle) inFence = !inFence;

            // Only break on size when not inside a code fence and not mid-heading.
            if (!inFence && !isHeading && bufLength() >= options.chunkSize) {
                // Carry a small overlap tail into the next chunk for continuity.
                const tail = this._overlapTail(buf, options.chunkOverlap);
                flush(lineNo + 1, posOfLine + line.length + 1);
                if (tail.length > 0) {
                    buf = [...tail];
                }
            }

            posOfLine += line.length + 1; // +1 for the split "\n"
        }

        if (buf.length > 0) flush(0, 0);

        const totalChunks = chunks.length;
        return chunks.map((chunk) => ({
            ...chunk,
            metadata: { ...chunk.metadata, totalChunks },
        }));
    }

    /** Detect an OpenAPI / Swagger JSON spec by the presence of `paths` + version key. */
    private _isOpenApiJson(content: string): boolean {
        // Quick pre-check before full parse.
        if (
            !content.includes('"paths"') && !content.includes('"swagger"') &&
            !content.includes('"openapi"')
        ) {
            return false;
        }
        try {
            const obj = JSON.parse(content);
            return (
                typeof obj === "object" && obj !== null &&
                typeof obj.paths === "object" &&
                (typeof obj.openapi === "string" || typeof obj.swagger === "string")
            );
        } catch {
            return false;
        }
    }

    /**
     * Chunk an OpenAPI JSON spec at the endpoint level.
     * Each `paths[path][method]` entry becomes its own chunk so the vector search
     * can retrieve individual endpoint definitions instead of a large combined blob.
     */
    private _chunkOpenApiJson(
        content: string,
        fileName: string,
        _options: ChunkingOptions,
        fileId?: string,
    ): types.file.FileShard[] {
        try {
            const spec = JSON.parse(content) as Record<string, unknown>;
            const paths = spec.paths as Record<string, Record<string, unknown>> | undefined;
            if (!paths) return [];

            const info = spec.info as Record<string, unknown> | undefined;
            const apiTitle = (info?.title as string) || fileName;
            const baseDescription = info?.description
                ? `\n${String(info.description).slice(0, 300)}`
                : "";

            const chunks: types.file.FileShard[] = [];
            let chunkId = 1;

            for (const [apiPath, methods] of Object.entries(paths)) {
                for (const [method, definition] of Object.entries(methods)) {
                    if (["parameters", "summary", "description"].includes(method)) continue;
                    const def = definition as Record<string, unknown>;
                    const summary = (def?.summary as string) || "";
                    const description = (def?.description as string) || "";
                    const operationId = (def?.operationId as string) || "";

                    const chunkContent = [
                        `# ${method.toUpperCase()} ${apiPath}${summary ? ` — ${summary}` : ""}`,
                        `**API:** ${apiTitle}${baseDescription}`,
                        `**Operation:** ${operationId || `${method.toUpperCase()} ${apiPath}`}`,
                        description ? `\n${description}` : "",
                        "\n```json",
                        JSON.stringify({ [method]: definition }, null, 2).slice(0, 3000),
                        "```",
                    ].filter(Boolean).join("\n");

                    chunks.push({
                        content: chunkContent,
                        metadata: {
                            fileId,
                            fileName,
                            chunkId: chunkId++,
                            chunkSize: chunkContent.length,
                            startPosition: 0,
                            lineNumber: 0,
                            section: `${method.toUpperCase()} ${apiPath}`,
                        },
                    });
                }
            }

            const totalChunks = chunks.length;
            return chunks.map((c) => ({ ...c, metadata: { ...c.metadata, totalChunks } }));
        } catch {
            return [];
        }
    }

    /** Return the trailing lines whose combined length is ~maxChars (for overlap). */
    private _overlapTail(buf: string[], maxChars: number): string[] {
        if (maxChars <= 0) return [];
        const tail: string[] = [];
        let total = 0;
        for (let i = buf.length - 1; i >= 0; i--) {
            total += buf[i].length + 1;
            tail.unshift(buf[i]);
            if (total >= maxChars) break;
        }
        return tail;
    }
}
