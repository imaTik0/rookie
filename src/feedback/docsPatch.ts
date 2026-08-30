import type { CorpusFile } from "./fragmentVerify.ts";
import type { GapCluster } from "./gapAggregate.ts";

export interface DocsPatchResult {
    patch: string;
    markdown: string;
    patchedClusters: number;
    unpatchedClusters: number;
}

interface FileEdit {
    file: string;
    lineStart: number;
    lineEnd: number;
    replacement: string;
    cluster: GapCluster;
}

function unifiedDiffFor(
    file: string,
    originalLines: string[],
    edit: FileEdit,
    context = 2,
): string {
    const startIdx = edit.lineStart - 1;
    const endIdx = edit.lineEnd - 1;
    const ctxStart = Math.max(0, startIdx - context);
    const ctxEnd = Math.min(originalLines.length - 1, endIdx + context);

    const removed = originalLines.slice(startIdx, endIdx + 1);
    const added = edit.replacement.split("\n");

    const lines: string[] = [];
    lines.push(`--- a/${file}`);
    lines.push(`+++ b/${file}`);
    const oldCount = ctxEnd - ctxStart + 1;
    const newCount = oldCount - removed.length + added.length;
    lines.push(`@@ -${ctxStart + 1},${oldCount} +${ctxStart + 1},${newCount} @@`);
    for (let i = ctxStart; i < startIdx; i++) lines.push(` ${originalLines[i]}`);
    for (const l of removed) lines.push(`-${l}`);
    for (const l of added) lines.push(`+${l}`);
    for (let i = endIdx + 1; i <= ctxEnd; i++) lines.push(` ${originalLines[i]}`);
    return lines.join("\n");
}

function dedupeOverlapping(edits: FileEdit[]): FileEdit[] {
    const byFile = new Map<string, FileEdit[]>();
    for (const e of edits) {
        const list = byFile.get(e.file) ?? [];
        const overlaps = list.some(
            (o) => Math.min(o.lineEnd, e.lineEnd) - Math.max(o.lineStart, e.lineStart) >= 0,
        );
        if (!overlaps) {
            list.push(e);
            byFile.set(e.file, list);
        }
    }
    return [...byFile.values()].flat();
}

export function generateDocsPatch(
    clusters: GapCluster[],
    corpus: CorpusFile[],
): DocsPatchResult {
    const fileMap = new Map(corpus.map((f) => [f.filename, f.content]));

    const edits: FileEdit[] = [];
    const unpatchable: GapCluster[] = [];

    for (const cluster of clusters) {
        const content = cluster.file ? fileMap.get(cluster.file) : undefined;
        const canPatch = cluster.verified &&
            cluster.file !== undefined &&
            content !== undefined &&
            cluster.lineStart !== undefined &&
            cluster.lineEnd !== undefined &&
            cluster.proposedFix.trim().length > 0;
        if (canPatch) {
            edits.push({
                file: cluster.file!,
                lineStart: cluster.lineStart!,
                lineEnd: cluster.lineEnd!,
                replacement: cluster.proposedFix.trim(),
                cluster,
            });
        } else {
            unpatchable.push(cluster);
        }
    }

    const accepted = dedupeOverlapping(
        edits.sort((a, b) => b.cluster.occurrences - a.cluster.occurrences),
    );

    const hunks: string[] = [];
    for (
        const edit of accepted.sort((a, b) =>
            a.file.localeCompare(b.file) || a.lineStart - b.lineStart
        )
    ) {
        const content = fileMap.get(edit.file)!;
        hunks.push(unifiedDiffFor(edit.file, content.split("\n"), edit));
    }
    const patch = hunks.join("\n\n") + (hunks.length ? "\n" : "");

    const md: string[] = [];
    md.push(`# Documentation fix proposal`);
    md.push("");
    md.push(
        `${clusters.length} distinct gap(s) found — ${accepted.length} patchable, ${unpatchable.length} suggestion(s) without a verified location.`,
    );
    md.push("");
    if (accepted.length > 0) {
        md.push(`## Proposed changes`);
        md.push("");
        for (const edit of accepted) {
            const c = edit.cluster;
            md.push(
                `### \`${edit.file}\` lines ${edit.lineStart}–${edit.lineEnd} — ${c.documentationGap}` +
                    (c.meanConfidence !== undefined ? ` (confidence ${c.meanConfidence})` : ""),
            );
            md.push("");
            md.push(
                `Hit by ${c.occurrences} failing execution(s): ${
                    c.affectedGoals.map((g) => `"${g}"`).join(", ")
                }. Failing call: \`${c.failedFunction}\`.`,
            );
            md.push("");
            md.push("```diff");
            md.push(unifiedDiffFor(edit.file, fileMap.get(edit.file)!.split("\n"), edit));
            md.push("```");
            md.push("");
        }
    }
    if (unpatchable.length > 0) {
        md.push(`## Suggestions without a verified docs location`);
        md.push("");
        for (const c of unpatchable) {
            md.push(
                `- **${c.documentationGap}** (\`${c.failedFunction}\`, ×${c.occurrences}): ${
                    c.proposedFix || "no concrete fix proposed"
                }`,
            );
        }
        md.push("");
    }

    return {
        patch,
        markdown: md.join("\n"),
        patchedClusters: accepted.length,
        unpatchedClusters: unpatchable.length,
    };
}
