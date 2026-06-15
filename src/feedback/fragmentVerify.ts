/**
 * Fragment verification: ground an LLM-quoted documentation fragment in the
 * actual documentation corpus.
 *
 * The failure classifier quotes a "pinpointed fragment" of the docs it blames
 * for a crash. LLMs paraphrase and hallucinate, so before we present (or patch)
 * a fragment we locate it in the real files:
 *   1. exact substring match,
 *   2. whitespace-normalised match,
 *   3. fuzzy sliding-window match (token-overlap score over line windows).
 *
 * Pure & dependency-free — unit-tested in feedback.test.ts.
 */

export interface CorpusFile {
    filename: string;
    content: string;
}

export interface FragmentVerification {
    /** True when the fragment was located in the corpus with score >= threshold. */
    verified: boolean;
    /** Best-matching file, if any. */
    file?: string;
    /** 1-based line range of the best match. */
    lineStart?: number;
    lineEnd?: number;
    /** Similarity score 0..1 of the best match (1 = exact). */
    matchScore: number;
    /** The actual text found in the file (ground truth to diff against). */
    matchedText?: string;
}

/** Strip a leading "[filename]:"-style prefix the classifier is told to add. */
export function splitFragmentPrefix(
    fragment: string,
): { fileHint?: string; text: string } {
    const m = fragment.match(/^\s*\[([^\]\n]{1,128})\]\s*:?\s*([\s\S]*)$/);
    if (m && m[2].trim().length > 0) {
        return { fileHint: m[1].trim(), text: m[2].trim() };
    }
    return { text: fragment.trim() };
}

function normalizeWs(s: string): string {
    return s.replace(/\s+/g, " ").trim();
}

function tokenize(s: string): string[] {
    return normalizeWs(s.toLowerCase())
        .split(/[^a-z0-9_$.@/-]+/i)
        .filter((t) => t.length > 1);
}

/** Jaccard-style token overlap between two strings (0..1). */
export function tokenOverlap(a: string, b: string): number {
    const ta = new Set(tokenize(a));
    const tb = new Set(tokenize(b));
    if (ta.size === 0 || tb.size === 0) return 0;
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    return inter / (ta.size + tb.size - inter);
}

/** Locate `needleLines`-sized windows in a file and score them against the fragment. */
function bestWindowMatch(
    fragmentText: string,
    content: string,
): { score: number; lineStart: number; lineEnd: number; matchedText: string } | null {
    const lines = content.split("\n");
    const fragLines = fragmentText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    // Size the window to the fragment itself (clamped to the document length). A
    // previous floor of 10 lines diluted the token-overlap score of short
    // single-line fragments below the verify threshold even when they were a near
    // word-for-word paraphrase of a doc line.
    const desired = Math.max(1, Math.min(fragLines.length, 30));
    const windowSize = Math.min(desired, Math.max(1, lines.length));

    let best: { score: number; lineStart: number; lineEnd: number; matchedText: string } | null =
        null;

    // Pre-filter: only score windows around lines sharing at least one rare token
    // with the fragment, otherwise large corpora get O(n) full scoring anyway —
    // acceptable for docs-sized files (we keep it simple and exhaustive).
    for (let i = 0; i <= lines.length - windowSize; i++) {
        const window = lines.slice(i, i + windowSize).join("\n");
        const score = tokenOverlap(fragmentText, window);
        if (!best || score > best.score) {
            best = {
                score,
                lineStart: i + 1,
                lineEnd: i + windowSize,
                matchedText: window,
            };
        }
    }
    return best;
}

function locateExact(
    text: string,
    content: string,
): { lineStart: number; lineEnd: number } | null {
    const idx = content.indexOf(text);
    if (idx === -1) return null;
    const before = content.slice(0, idx);
    const lineStart = before.split("\n").length;
    const lineEnd = lineStart + text.split("\n").length - 1;
    return { lineStart, lineEnd };
}

export const FUZZY_VERIFY_THRESHOLD = 0.55;

/**
 * Verify a pinpointed fragment against the documentation corpus.
 * Files matching the classifier's filename hint are tried first.
 */
export function verifyFragment(
    fragment: string | undefined,
    corpus: CorpusFile[],
    threshold: number = FUZZY_VERIFY_THRESHOLD,
): FragmentVerification {
    if (!fragment || fragment.trim().length === 0 || corpus.length === 0) {
        return { verified: false, matchScore: 0 };
    }

    const { fileHint, text } = splitFragmentPrefix(fragment);
    if (text.length === 0) return { verified: false, matchScore: 0 };

    const ordered = [...corpus].sort((a, b) => {
        const aHit = fileHint && a.filename.toLowerCase().includes(fileHint.toLowerCase()) ? 0 : 1;
        const bHit = fileHint && b.filename.toLowerCase().includes(fileHint.toLowerCase()) ? 0 : 1;
        return aHit - bHit;
    });

    // 1. Exact match.
    for (const file of ordered) {
        const loc = locateExact(text, file.content);
        if (loc) {
            return {
                verified: true,
                file: file.filename,
                lineStart: loc.lineStart,
                lineEnd: loc.lineEnd,
                matchScore: 1,
                matchedText: text,
            };
        }
    }

    // 2. Whitespace-normalised exact match (locate via fuzzy window for line numbers).
    const normText = normalizeWs(text);
    for (const file of ordered) {
        if (normalizeWs(file.content).includes(normText)) {
            const windowed = bestWindowMatch(text, file.content);
            return {
                verified: true,
                file: file.filename,
                lineStart: windowed?.lineStart,
                lineEnd: windowed?.lineEnd,
                matchScore: 0.95,
                matchedText: windowed?.matchedText ?? text,
            };
        }
    }

    // 3. Fuzzy window match across all files.
    let best: (FragmentVerification & { score: number }) | null = null;
    for (const file of ordered) {
        const match = bestWindowMatch(text, file.content);
        if (match && (!best || match.score > best.score)) {
            best = {
                verified: match.score >= threshold,
                file: file.filename,
                lineStart: match.lineStart,
                lineEnd: match.lineEnd,
                matchScore: Math.round(match.score * 1000) / 1000,
                matchedText: match.matchedText,
                score: match.score,
            };
        }
    }
    if (best) {
        const { score: _score, ...verification } = best;
        return verification;
    }
    return { verified: false, matchScore: 0 };
}

/** Decode `{ metadata, buffer }` project files into a text corpus. */
export function corpusFromFiles(
    files: { metadata: { filename?: string }; buffer: Uint8Array }[],
): CorpusFile[] {
    const decoder = new TextDecoder();
    return files.map((f) => ({
        filename: f.metadata?.filename ?? "unknown",
        content: decoder.decode(f.buffer),
    }));
}

/** True when any corpus file mentions the given package/module name. */
export function corpusMentions(corpus: CorpusFile[], term: string): boolean {
    if (!term) return false;
    const needle = term.toLowerCase();
    return corpus.some((f) => f.content.toLowerCase().includes(needle));
}

/** Extract the missing module name from a Node MODULE_NOT_FOUND-style error. */
export function extractMissingModule(error: string): string | null {
    const patterns = [
        /Cannot find (?:module|package) '([^']+)'/i,
        /Cannot find (?:module|package) "([^"]+)"/i,
        /Cannot find (?:module|package) ([^\s']+)/i,
    ];
    for (const re of patterns) {
        const m = error.match(re);
        if (m?.[1]) {
            const spec = m[1];
            if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("file:")) {
                return null; // relative imports are codegen bugs, not docs/config gaps
            }
            const parts = spec.split("/");
            return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
        }
    }
    return null;
}
