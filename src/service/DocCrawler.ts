import { Logger } from "../Logger.ts";
import striptags from "striptags";

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

const DEFAULT_OPTIONS: CrawlOptions = {
    maxPages: 50,
    concurrency: 2,
    delayMs: 500,
    sameDomainOnly: true,
    fetchTimeoutMs: 10000,
};

export class DocCrawler {
    constructor(private logger: Logger) {}

    async crawl(
        startUrl: string,
        onProgress?: (msg: string) => void,
        options: Partial<CrawlOptions> = {},
    ): Promise<CrawledPage[]> {
        const opts = { ...DEFAULT_OPTIONS, ...options };
        const startOrigin = new URL(startUrl).origin;
        const startPathPrefix = this.getPathPrefix(startUrl);

        const visited = new Set<string>();
        const queued = new Set<string>();
        const queue: string[] = [];
        const results: CrawledPage[] = [];

        const startNormalized = this.normalizeUrl(startUrl);
        queue.push(startNormalized);
        queued.add(startNormalized);

        this.logger.log(`Starting crawl from: ${startUrl} (max: ${opts.maxPages} pages)`);
        onProgress?.(`Starting crawl from: ${startUrl} (max: ${opts.maxPages} pages)`);

        while (queue.length > 0 && results.length < opts.maxPages) {
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

        this.logger.log(`Crawl complete: ${results.length} pages indexed`);
        onProgress?.(`Crawl complete: ${results.length} pages indexed`);

        return results;
    }

    private async fetchPage(
        url: string,
        originFilter: string,
        pathPrefix: string,
        opts: CrawlOptions,
    ): Promise<{ url: string; markdown: string; title: string; links: string[] } | null> {
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

            // Extract links from raw HTML before stripping
            const links = this.extractLinksFromHtml(
                html,
                url,
                originFilter,
                pathPrefix,
                opts.sameDomainOnly,
            );

            // Extract title
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            const title = titleMatch ? titleMatch[1].trim() : this.urlToSlug(url);

            // Strip HTML to clean text, keeping some structure
            const bodyMatch = html.match(
                /<(?:main|article|body)[^>]*>([\s\S]*?)<\/(?:main|article|body)>/i,
            );
            const contentHtml = bodyMatch ? bodyMatch[1] : html;

            // Remove script, style tags entirely
            let cleaned = contentHtml
                .replace(/<script[\s\S]*?<\/script>/gi, "")
                .replace(/<style[\s\S]*?<\/style>/gi, "");

            // If we found a specific content tag (main/article), we are more aggressive with layout
            if (
                bodyMatch &&
                (bodyMatch[0].toLowerCase().startsWith("<main") ||
                    bodyMatch[0].toLowerCase().startsWith("<article"))
            ) {
                cleaned = cleaned
                    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
                    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
                    .replace(/<header[\s\S]*?<\/header>/gi, "");
            }

            // Convert headings to markdown-like format before stripping
            let text = cleaned
                .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "\n# $1\n")
                .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "\n## $1\n")
                .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "\n### $1\n")
                .replace(/<h4[^>]*>(.*?)<\/h4>/gi, "\n#### $1\n")
                .replace(/<li[^>]*>/gi, "\n- ")
                .replace(/<br\s*\/?>/gi, "\n")
                .replace(/<\/p>/gi, "\n\n")
                .replace(/<\/div>/gi, "\n");

            // Preserve code blocks
            text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, " `$1` ");
            text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");

            // Strip remaining HTML
            text = striptags(text);

            // Clean up whitespace
            text = text
                .replace(/\n{3,}/g, "\n\n")
                .replace(/[ \t]+/g, " ")
                .replace(/\n /g, "\n")
                .trim();

            if (text.length < 50) return null;

            return { url, markdown: `# ${title}\nSource: ${url}\n\n${text}`, title, links };
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

    private extractLinksFromHtml(
        html: string,
        currentUrl: string,
        originFilter: string,
        pathPrefix: string,
        sameDomainOnly: boolean,
    ): string[] {
        const links: string[] = [];
        const seen = new Set<string>();
        const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
        let match;

        while ((match = linkRegex.exec(html)) !== null) {
            let href = match[1];

            if (
                href.startsWith("#") || href.startsWith("mailto:") ||
                href.startsWith("javascript:") || href.startsWith("data:")
            ) continue;
            if (/\.(png|jpg|jpeg|gif|svg|ico|webp|mp4|pdf|zip|tar|gz|css|js)$/i.test(href)) {
                continue;
            }

            try {
                const resolved = new URL(href, currentUrl);
                href = resolved.origin + resolved.pathname;
            } catch {
                continue;
            }

            if (sameDomainOnly) {
                try {
                    const parsed = new URL(href);
                    if (parsed.origin !== originFilter) continue;
                    if (pathPrefix && !parsed.pathname.startsWith(pathPrefix)) continue;
                } catch {
                    continue;
                }
            }

            href = href.replace(/\/+$/, "") || href;

            if (href && !seen.has(href)) {
                seen.add(href);
                links.push(href);
            }
        }

        return links;
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
            const path = parsed.pathname.replace(/\/+$/, "") || "/";
            return `${parsed.origin}${path}`;
        } catch {
            return url;
        }
    }

    private urlToSlug(url: string): string {
        try {
            const parsed = new URL(url);
            return parsed.pathname
                .replace(/^\//, "")
                .replace(/\//g, "_")
                .replace(/[^a-zA-Z0-9_-]/g, "") || "index";
        } catch {
            return "page";
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
