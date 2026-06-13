/**
 * Documentation patch generation: turn verified gap findings into an applyable
 * unified diff plus a PR-style markdown summary.
 *
 * Only VERIFIED fragments (located in the real files by fragmentVerify) are
 * patched — unverified LLM quotes are listed as suggestions instead of hunks.
 *
 * Pure & dependency-free — unit-tested in feedback.test.ts.
 */
import type { CorpusFile } from "./fragmentVerify.ts";
import type { GapCluster } from "./gapAggregate.ts";

export interface DocsPatchResult {
    /** Unified diff across all patched files ("" when nothing was patchable). */
    patch: string;
    /** PR-style markdown: summary table, hunks, and unpatchable suggestions. */
    markdown: string;
    patchedClusters: number;
    unpatchedClusters: number;
}

interface FileEdit {
    file: string;
    lineStart: number; // 1-based, inclusive
    lineEnd: number; // 1-based, inclusive
    replacement: string;
    cluster: GapCluster;
}

/** Build a single-hunk unified diff for one edit. */
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
        // Skip edits overlapping an already-accepted edit in the same file.
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

/** Generate a docs patch from gap clusters + the original documentation corpus. */
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
    for (const edit of accepted.sort((a, b) =>
        a.file.localeCompare(b.file) || a.lineStart - b.lineStart
    )) {
        const content = fileMap.get(edit.file)!;
        hunks.push(unifiedDiffFor(edit.file, content.split("\n"), edit));
    }
    const patch = hunks.join("\n\n") + (hunks.length ? "\n" : "");

    // ── Markdown ──
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
            md.push(`- **${c.documentationGap}** (\`${c.failedFunction}\`, ×${c.occurrences}): ${
                c.proposedFix || "no concrete fix proposed"
            }`);
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
