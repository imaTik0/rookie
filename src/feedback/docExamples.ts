/**
 * Extract runnable code examples from project documentation files.
 *
 * Finds fenced code blocks labelled `js`, `javascript`, `ts`, or `typescript`
 * and bundles them with enough surrounding prose context for the executor to
 * attribute failures back to the right documentation section.
 */

export interface DocExample {
    /** Source documentation file. */
    filename: string;
    /** Code language tag on the fence. */
    language: string;
    /** The raw code inside the fence. */
    code: string;
    /** 1-based line number of the opening fence. */
    lineNumber: number;
    /** Nearest preceding heading, for labelling in reports. */
    section?: string;
    /** Prose paragraph immediately before the code block (for context). */
    context?: string;
}

const JS_LIKE = new Set(["js", "javascript", "ts", "typescript", "mjs", "cjs"]);

/**
 * Extract all runnable JS/TS code examples from the project's documentation files.
 * Skips trivially short snippets (< 20 chars of meaningful code).
 */
export function extractDocExamples(
    files: { metadata: { filename: string }; buffer: Uint8Array }[],
): DocExample[] {
    const examples: DocExample[] = [];
    const dec = new TextDecoder();

    for (const file of files) {
        const filename = file.metadata.filename;
        // Only scan text/markdown/plain files; skip binaries.
        if (!filename.match(/\.(md|txt|rst|mdx|html?)$/i) &&
            !filename.match(/\.(js|ts|mjs|cjs)$/i)) continue;

        const content = dec.decode(file.buffer);
        const lines = content.split("\n");
        let currentSection = "";

        let i = 0;
        while (i < lines.length) {
            // Track the most recent heading as section context.
            const headingMatch = lines[i].match(/^#{1,6}\s+(.*)/);
            if (headingMatch) {
                currentSection = headingMatch[1].trim();
            }

            // Detect opening fence: ```<lang>
            const fenceMatch = lines[i].match(/^```([a-z]*)(\s.*)?$/i);
            if (fenceMatch) {
                const lang = fenceMatch[1].toLowerCase();
                if (JS_LIKE.has(lang) || lang === "") {
                    // Only capture if explicitly JS/TS (skip unlabelled fences to avoid noise).
                    if (!JS_LIKE.has(lang)) { i++; continue; }

                    const fenceStartLine = i + 1; // 1-based
                    const codeLines: string[] = [];
                    i++;
                    while (i < lines.length && !lines[i].match(/^```/)) {
                        codeLines.push(lines[i]);
                        i++;
                    }

                    const code = codeLines.join("\n").trim();
                    // Skip trivially short snippets that can't be meaningful programs.
                    if (code.length < 20) { i++; continue; }

                    // Collect context: prose lines immediately before the fence.
                    const contextLines: string[] = [];
                    for (let j = fenceStartLine - 2; j >= Math.max(0, fenceStartLine - 8); j--) {
                        const l = lines[j];
                        if (l.trim() === "" || l.match(/^#{1,6}\s+/)) break;
                        contextLines.unshift(l);
                    }

                    examples.push({
                        filename,
                        language: lang,
                        code,
                        lineNumber: fenceStartLine,
                        section: currentSection || undefined,
                        context: contextLines.length > 0 ? contextLines.join("\n") : undefined,
                    });
                }
            }
            i++;
        }
    }
    return examples;
}

/**
 * Build a short human-readable label for a doc example (used in report step descriptions).
 */
export function docExampleLabel(ex: DocExample): string {
    const parts = [ex.filename];
    if (ex.section) parts.push(ex.section);
    parts.push(`line ${ex.lineNumber}`);
    return parts.join(" › ");
}
