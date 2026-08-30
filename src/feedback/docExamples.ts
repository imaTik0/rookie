export interface DocExample {
    filename: string;
    language: string;
    code: string;
    lineNumber: number;
    section?: string;
    context?: string;
}

const JS_LIKE = new Set(["js", "javascript", "ts", "typescript", "mjs", "cjs"]);

export function extractDocExamples(
    files: { metadata: { filename: string }; buffer: Uint8Array }[],
): DocExample[] {
    const examples: DocExample[] = [];
    const dec = new TextDecoder();

    for (const file of files) {
        const filename = file.metadata.filename;
        if (
            !filename.match(/\.(md|txt|rst|mdx|html?)$/i) &&
            !filename.match(/\.(js|ts|mjs|cjs)$/i)
        ) continue;

        const content = dec.decode(file.buffer);
        const lines = content.split("\n");
        let currentSection = "";

        let i = 0;
        while (i < lines.length) {
            const headingMatch = lines[i].match(/^#{1,6}\s+(.*)/);
            if (headingMatch) {
                currentSection = headingMatch[1].trim();
            }

            const fenceMatch = lines[i].match(/^```([a-z]*)(\s.*)?$/i);
            if (fenceMatch) {
                const lang = fenceMatch[1].toLowerCase();
                if (JS_LIKE.has(lang) || lang === "") {
                    if (!JS_LIKE.has(lang)) {
                        i++;
                        continue;
                    }

                    const fenceStartLine = i + 1;
                    const codeLines: string[] = [];
                    i++;
                    while (i < lines.length && !lines[i].match(/^```/)) {
                        codeLines.push(lines[i]);
                        i++;
                    }

                    const code = codeLines.join("\n").trim();
                    if (code.length < 20) {
                        i++;
                        continue;
                    }

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

export function docExampleLabel(ex: DocExample): string {
    const parts = [ex.filename];
    if (ex.section) parts.push(ex.section);
    parts.push(`line ${ex.lineNumber}`);
    return parts.join(" › ");
}
