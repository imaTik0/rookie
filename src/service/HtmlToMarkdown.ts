import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { strikethrough, taskListItems } from "turndown-plugin-gfm";

export interface ParsedPage {
    title: string;
    markdown: string;
    links: string[];
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

const SPA_ROOT_SELECTORS = [
    "#swagger-ui",
    "#app",
    "#root",
    "#__next",
    "#__nuxt",
    "[data-reactroot]",
];

const ASSET_EXT = /\.(png|jpg|jpeg|gif|svg|ico|webp|mp4|pdf|zip|tar|gz|css|js)$/i;

const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
});
turndown.use([strikethrough, taskListItems]);

interface TurndownNode {
    querySelectorAll(
        selector: string,
    ): ArrayLike<{ children: ArrayLike<{ textContent?: string }> }>;
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

    const links = extractLinks(document, opts);

    const bodyText = document.body?.textContent?.trim() ?? "";
    if (bodyText.length < opts.spaMinTextChars && hasSpaRoot(document)) {
        return { title: docTitle, markdown: "", links, isLikelySpa: true };
    }

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
