/**
 * HTML → Markdown extraction for the documentation crawler.
 *
 * Pipeline: linkedom (real DOM) → Mozilla Readability (main-content extraction,
 * drops nav/sidebar/footer) → Turndown + GFM (DOM→Markdown, keeps tables and
 * fenced code). Falls back to direct main/body extraction when Readability
 * returns too little (common on terse API reference pages), and detects
 * unrendered single-page-app shells so the crawler can skip them.
 */
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { strikethrough, taskListItems } from "turndown-plugin-gfm";

export interface ParsedPage {
    title: string;
    /** Clean Markdown with a `# title` + `Source:` header, or "" when skipped. */
    markdown: string;
    /** Same-origin links discovered on the page (origin + pathname, trailing slash kept). */
    links: string[];
    /** True when the page looks like an unrendered JS shell (no real content). */
    isLikelySpa: boolean;
}

export interface ParseOptions {
    pageUrl: string;
    originFilter: string;
    pathPrefix: string;
    sameDomainOnly: boolean;
    spaMinTextChars: number;
    readabilityMinChars: number;
}

// Minimal structural DOM types — linkedom's exported types don't surface
// `document` on the parseHTML return, so we describe just what we use.
interface DomNode {
    textContent?: string | null;
    innerHTML?: string;
    getAttribute(name: string): string | null;
}
interface DomDocument {
    body: DomNode | null;
    querySelector(selector: string): DomNode | null;
    querySelectorAll(selector: string): Iterable<DomNode>;
}

// CSS selectors that signal a client-rendered app root with no server HTML.
const SPA_ROOT_SELECTORS = [
    "#swagger-ui",
    "#app",
    "#root",
    "#__next",
    "#__nuxt",
    "[data-reactroot]",
];

const ASSET_EXT = /\.(png|jpg|jpeg|gif|svg|ico|webp|mp4|pdf|zip|tar|gz|css|js)$/i;

// Single shared Turndown instance — configured once, reused per call.
const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
});
// GFM strikethrough + task lists, but NOT the GFM table rule — it only fires on
// tables that have a header row, leaving headerless docs tables (e.g. Redoc API
// parameter tables) as raw HTML. The custom rule below handles all tables.
turndown.use([strikethrough, taskListItems]);

interface TurndownNode {
    querySelectorAll(selector: string): ArrayLike<{ children: ArrayLike<{ textContent?: string }> }>;
}

turndown.addRule("anyTable", {
    filter: "table",
    replacement: (_content: string, node: unknown): string => {
        const rows = Array.from((node as TurndownNode).querySelectorAll("tr"));
        if (rows.length === 0) return "";

        const cellText = (cell: { textContent?: string }) =>
            (cell.textContent ?? "").replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
        const matrix = rows.map((tr) => Array.from(tr.children).map(cellText));

        const cols = Math.max(...matrix.map((r) => r.length));
        const pad = (r: string[]) => {
            const copy = r.slice();
            while (copy.length < cols) copy.push("");
            return copy;
        };

        // Use the first row as the header (synthesises one for headerless tables
        // so the result is always a valid GFM table that the chunker preserves).
        const [header, ...body] = matrix.map(pad);
        const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
        const sep = `| ${header.map(() => "---").join(" | ")} |`;
        return "\n\n" + [line(header), sep, ...body.map(line)].join("\n") + "\n\n";
    },
});

export function htmlToMarkdown(html: string, opts: ParseOptions): ParsedPage {
    const { document } = parseHTML(html) as unknown as { document: DomDocument };

    const docTitle = document.querySelector("title")?.textContent?.trim() ||
        urlToTitle(opts.pageUrl);

    // Extract links BEFORE Readability runs — it mutates/strips the document.
    const links = extractLinks(document, opts);

    // SPA detection: tiny body text + a known client-render root ⇒ no real content.
    const bodyText = document.body?.textContent?.trim() ?? "";
    if (bodyText.length < opts.spaMinTextChars && hasSpaRoot(document)) {
        return { title: docTitle, markdown: "", links, isLikelySpa: true };
    }

    // Primary: Readability main-content extraction.
    let articleHtml = "";
    let title = docTitle;
    try {
        // deno-lint-ignore no-explicit-any
        const article = new Readability(document as any).parse();
        if (article && (article.length ?? 0) >= opts.readabilityMinChars) {
            articleHtml = article.content ?? "";
            title = article.title?.trim() || docTitle;
        }
    } catch {
        // fall through to fallback extraction
    }

    // Fallback: terse/reference pages where Readability bails — take the most
    // content-bearing container directly so tables/params are still captured.
    if (!articleHtml) {
        const container = document.querySelector("main") ??
            document.querySelector("article") ??
            document.body;
        articleHtml = container?.innerHTML ?? "";
    }

    const body = articleHtml ? turndown.turndown(articleHtml).trim() : "";
    if (!body) {
        return { title, markdown: "", links, isLikelySpa: false };
    }

    const markdown = `# ${title}\nSource: ${opts.pageUrl}\n\n${body}`;
    return { title, markdown, links, isLikelySpa: false };
}

function hasSpaRoot(document: DomDocument): boolean {
    return SPA_ROOT_SELECTORS.some((sel) => document.querySelector(sel) !== null);
}

function extractLinks(document: DomDocument, opts: ParseOptions): string[] {
    const out: string[] = [];
    const seen = new Set<string>();

    for (const anchor of document.querySelectorAll("a[href]")) {
        const raw = anchor.getAttribute("href");
        if (!raw) continue;

        if (
            raw.startsWith("#") || raw.startsWith("mailto:") ||
            raw.startsWith("javascript:") || raw.startsWith("data:")
        ) continue;
        if (ASSET_EXT.test(raw)) continue;

        let href: string;
        try {
            const resolved = new URL(raw, opts.pageUrl);
            // Preserve the trailing slash; normalizeUrl in the crawler canonicalizes.
            href = resolved.origin + resolved.pathname;
        } catch {
            continue;
        }

        if (opts.sameDomainOnly) {
            try {
                const parsed = new URL(href);
                if (parsed.origin !== opts.originFilter) continue;
                if (opts.pathPrefix && !parsed.pathname.startsWith(opts.pathPrefix)) continue;
            } catch {
                continue;
            }
        }

        if (!seen.has(href)) {
            seen.add(href);
            out.push(href);
        }
    }

    return out;
}

function urlToTitle(url: string): string {
    try {
        const { pathname } = new URL(url);
        const last = pathname.split("/").filter(Boolean).pop();
        return last ? decodeURIComponent(last).replace(/[-_]/g, " ") : "index";
    } catch {
        return "page";
    }
}
