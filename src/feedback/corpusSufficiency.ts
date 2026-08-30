const TEXT_EXT = /\.(md|mdx|txt|rst|html?|json|ya?ml|js|ts|mjs|cjs)$/i;

const METHOD_PATH_RE = /\b(GET|POST|PUT|PATCH|DELETE)\s+\/[\w{]/gi;
const AUTH_RE = /authorization|bearer|api[-_ ]?key|token/gi;
const HEADING_RE = /^#{1,6}\s+\S/gm;

export interface CorpusStats {
    files: number;
    totalChars: number;
    headings: number;
    codeBlocks: number;
    endpointMentions: number;
    authMentions: number;
}

export interface CorpusAssessment {
    sufficient: boolean;
    warnings: string[];
    stats: CorpusStats;
}

export function assessCorpus(
    files: { metadata: { filename: string }; buffer: Uint8Array }[],
    minCorpusChars: number,
): CorpusAssessment {
    const dec = new TextDecoder();
    const sizes: number[] = [];
    let totalChars = 0;
    let headings = 0;
    let codeBlocks = 0;
    let endpointMentions = 0;
    let authMentions = 0;

    for (const file of files) {
        if (!TEXT_EXT.test(file.metadata.filename)) continue;
        const content = dec.decode(file.buffer);
        sizes.push(content.length);
        totalChars += content.length;
        headings += content.match(HEADING_RE)?.length ?? 0;
        codeBlocks += Math.floor((content.match(/^\s*```/gm)?.length ?? 0) / 2);
        endpointMentions += content.match(METHOD_PATH_RE)?.length ?? 0;
        authMentions += content.match(AUTH_RE)?.length ?? 0;
    }

    const stats: CorpusStats = {
        files: files.length,
        totalChars,
        headings,
        codeBlocks,
        endpointMentions,
        authMentions,
    };

    const warnings: string[] = [];
    if (codeBlocks === 0 && totalChars > 0) {
        warnings.push(
            "The corpus contains no fenced code examples — example-free documentation is the " +
                "strongest known predictor of integration failure; expect low pass rates that " +
                "reflect missing examples rather than other gap categories.",
        );
    }
    if (endpointMentions === 0 && authMentions === 0 && totalChars > 0) {
        warnings.push(
            "No HTTP-API traces found (no `METHOD /path` patterns, no auth vocabulary) — " +
                "if this project targets a REST API, the crawl likely captured the wrong pages; " +
                "if it documents a library, this warning can be ignored.",
        );
    }
    const avg = sizes.length > 0 ? totalChars / sizes.length : 0;
    if (sizes.length >= 5 && avg < 500) {
        warnings.push(
            `Average page size is only ${Math.round(avg)} chars across ${sizes.length} files — ` +
                "the crawl likely captured navigation shells or stub pages instead of content.",
        );
    }
    const largest = sizes.length > 1 ? Math.max(...sizes) : 0;
    if (sizes.length > 1 && totalChars > 0 && largest / totalChars > 0.9) {
        warnings.push(
            "A single file holds >90% of the corpus content; the remaining files are stubs. " +
                "Retrieval will keep returning chunks of that one file.",
        );
    }

    const sufficient = minCorpusChars <= 0 || totalChars >= minCorpusChars;
    if (!sufficient) {
        warnings.unshift(
            `Corpus has only ${totalChars} chars of readable content ` +
                `(minimum: ${minCorpusChars}) — too thin to evaluate meaningfully.`,
        );
    }

    return { sufficient, warnings, stats };
}
