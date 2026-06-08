import { Logger } from "../Logger.ts";
import { ConfigService } from "./ConfigService.ts";
import { htmlToMarkdown } from "./HtmlToMarkdown.ts";
import { JobCancelledError } from "../types/job.ts";

export interface CrawlOptions {
    maxPages: number;
    concurrency: number;
    delayMs: number;
    sameDomainOnly: boolean;
    fetchTimeoutMs: number;
}

export interface CrawledPage {
    url: string;
    markdown: string;
    title: string;
}

interface FetchedPage {
    url: string;
    markdown: string;
    title: string;
    links: string[];
    isLikelySpa: boolean;
}

const DEFAULT_OPTIONS: CrawlOptions = {
    maxPages: 50,
    concurrency: 2,
    delayMs: 500,
    sameDomainOnly: true,
    fetchTimeoutMs: 10000,
};

export class DocCrawler {
    constructor(
        private logger: Logger,
        private configService: ConfigService,
    ) {}

    async crawl(
        startUrl: string,
        onProgress?: (msg: string) => void,
        options: Partial<CrawlOptions> = {},
        signal?: AbortSignal,
    ): Promise<CrawledPage[]> {
        const opts = { ...DEFAULT_OPTIONS, ...options };
        const startOrigin = new URL(startUrl).origin;
        const startPathPrefix = this.getPathPrefix(startUrl);

        // Standards-first: a single llms-full.txt holds the entire docs as
        // Markdown. If present, ingest it directly and skip crawling entirely.
        const llms = await this.tryLlmsFullTxt(startOrigin, onProgress, opts);
        if (llms) return llms;

        const visited = new Set<string>();
        const queued = new Set<string>();
        const queue: string[] = [];
        const results: CrawledPage[] = [];
        let startWasSpa = false;

        const startNormalized = this.normalizeUrl(startUrl);
        queue.push(startNormalized);
        queued.add(startNormalized);

        this.logger.log(`Starting crawl from: ${startUrl} (max: ${opts.maxPages} pages)`);
        onProgress?.(`Starting crawl from: ${startUrl} (max: ${opts.maxPages} pages)`);

        while (queue.length > 0 && results.length < opts.maxPages) {
            if (signal?.aborted) throw new JobCancelledError();
            const batchSize = Math.min(
                opts.concurrency,
                opts.maxPages - results.length,
                queue.length,
            );
            const batch = queue.splice(0, batchSize);

            this.logger.log(
                `Crawl batch: ${batch.length} URLs, ${queue.length} remaining, ${results.length} done`,
            );

            const fetchPromises = batch.map(async (url) => {
                if (visited.has(url)) return null;
                visited.add(url);

                try {
                    const page = await this.fetchPage(url, startOrigin, startPathPrefix, opts);
                    if (!page) return null;

                    if (page.isLikelySpa) {
                        this.logger.log(`Skipping JS-rendered page (no static HTML): ${url}`);
                        if (url === startNormalized) startWasSpa = true;
                        return null;
                    }

                    this.logger.log(
                        `Crawled: ${url} (${page.markdown.length} chars, ${page.links.length} links)`,
                    );
                    onProgress?.(`Crawled (${results.length + 1}/${opts.maxPages}): ${url}`);

                    for (const link of page.links) {
                        const normalized = this.normalizeUrl(link);
                        if (!visited.has(normalized) && !queued.has(normalized)) {
                            queued.add(normalized);
                            queue.push(normalized);
                        }
                    }

                    return { url: page.url, markdown: page.markdown, title: page.title };
                } catch (err) {
                    this.logger.error(err, `Failed to crawl: ${url}`);
                    return null;
                }
            });

            const pages = await Promise.all(fetchPromises);
            for (const page of pages) {
                if (page && results.length < opts.maxPages) results.push(page);
            }

            if (queue.length > 0 && results.length < opts.maxPages) {
                await this.delay(opts.delayMs);
            }
        }

        // The start URL was an unrendered SPA shell and nothing else was reachable.
        // Surface an actionable error instead of a generic "no pages" message.
        if (results.length === 0 && startWasSpa) {
            throw new Error(
                `The start page ${startUrl} appears to be a JavaScript-rendered app ` +
                    `(e.g. Swagger UI) with no server-side HTML. Rookie's crawler reads static ` +
                    `HTML only. Try either the raw OpenAPI/Swagger JSON URL (swagger-json ingestion) ` +
                    `or a server-rendered docs URL (e.g. a Redoc or static docs site).`,
            );
        }

        this.logger.log(`Crawl complete: ${results.length} pages indexed`);
        onProgress?.(`Crawl complete: ${results.length} pages indexed`);

        return results;
    }

    /**
     * Probe the origin for an `llms-full.txt` — a single Markdown file holding
     * the entire documentation (an emerging convention for LLM consumption).
     * Returns it as one page, or null if absent / too small to be real content.
     */
    private async tryLlmsFullTxt(
        origin: string,
        onProgress: ((msg: string) => void) | undefined,
        opts: CrawlOptions,
    ): Promise<CrawledPage[] | null> {
        const url = `${origin}/llms-full.txt`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), opts.fetchTimeoutMs);
        try {
            const res = await fetch(url, {
                headers: { "User-Agent": "Mozilla/5.0 (compatible; RookieBot/1.0)" },
                signal: controller.signal,
                redirect: "follow",
            });
            if (!res.ok) return null;
            const text = (await res.text()).trim();
            if (text.length < 500) return null; // an error page or stub, not real docs

            this.logger.log(`Found llms-full.txt (${text.length} chars) — skipping HTML crawl`);
            onProgress?.(`Found llms-full.txt — ingesting directly, skipping crawl`);
            return [{
                url,
                title: "llms-full.txt",
                markdown: `# Documentation\nSource: ${url}\n\n${text}`,
            }];
        } catch {
            return null; // no llms-full.txt — fall back to crawling
        } finally {
            clearTimeout(timer);
        }
    }

    private async fetchPage(
        url: string,
        originFilter: string,
        pathPrefix: string,
        opts: CrawlOptions,
    ): Promise<FetchedPage | null> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), opts.fetchTimeoutMs);

        try {
            const response = await fetch(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (compatible; RookieBot/1.0)",
                    "Accept": "text/html",
                },
                signal: controller.signal,
                redirect: "follow",
            });

            if (!response.ok) {
                this.logger.log(`HTTP ${response.status} for: ${url}`);
                return null;
            }

            const contentType = response.headers.get("content-type") || "";
            if (!contentType.includes("text/html")) {
                this.logger.log(`Skipping non-HTML (${contentType}): ${url}`);
                return null;
            }

            const html = await response.text();
            if (!html || html.length < 100) return null;

            // Readability (main-content extraction) + Turndown (DOM→Markdown,
            // keeps tables/code). Link extraction + SPA detection happen inside.
            const { crawler } = this.configService.values;
            const parsed = htmlToMarkdown(html, {
                pageUrl: url,
                originFilter,
                pathPrefix,
                sameDomainOnly: opts.sameDomainOnly,
                spaMinTextChars: crawler.spaMinTextChars,
                readabilityMinChars: crawler.readabilityMinChars,
            });

            if (parsed.isLikelySpa) {
                return { url, markdown: "", title: parsed.title, links: parsed.links, isLikelySpa: true };
            }
            if (!parsed.markdown || parsed.markdown.length < 50) return null;

            return {
                url,
                markdown: parsed.markdown,
                title: parsed.title,
                links: parsed.links,
                isLikelySpa: false,
            };
        } catch (err) {
            if ((err as Error).name === "AbortError") {
                this.logger.log(`Timeout after ${opts.fetchTimeoutMs}ms for: ${url}`);
            } else {
                this.logger.log(`Fetch error for ${url}: ${(err as Error).message}`);
            }
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    private getPathPrefix(url: string): string {
        const parsed = new URL(url);
        const segments = parsed.pathname.split("/").filter(Boolean);

        // Only enforce a prefix if the URL ends with a slash or has multiple segments.
        // This suggests the user intended to crawl a specific subdirectory.
        if (url.endsWith("/") || segments.length > 1) {
            // If it's something like /docs/getting-started, we take /docs
            if (segments.length > 0) {
                return "/" + segments[0];
            }
        }
        return "";
    }

    private normalizeUrl(url: string): string {
        try {
            const parsed = new URL(url);
            // Collapse duplicate slashes but keep a single trailing slash on
            // path-only URLs (no file extension). Many static sites — including
            // Gitea's Redoc docs — return 404 for "/api/1.22" but 200 for
            // "/api/1.22/", so stripping unconditionally would break crawling.
            // Check only the last path segment; require alphabetic chars so
            // version numbers like "1.22" are not mistaken for file extensions.
            const lastSegment = parsed.pathname.split("/").filter((s) => s.length > 0).pop() ?? "";
            const hasExtension = /\.[a-zA-Z]{2,6}$/.test(lastSegment);
            const stripped = parsed.pathname.replace(/\/+$/, "") || "/";
            const hadTrailing = parsed.pathname.endsWith("/") && parsed.pathname !== "/";
            const path = (!hasExtension && hadTrailing) ? stripped + "/" : stripped;
            return `${parsed.origin}${path}`;
        } catch {
            return url;
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
