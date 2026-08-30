/**
 * mutationCorpus.ts — the post-cutoff mutation corpus (execa@10).
 *
 * A corpus of well-known libraries is useless for mutation testing: the model
 * knows those libraries so well it writes correct code despite an injected doc
 * defect, and every mutant survives (0 detection). This module instead builds
 * the gold corpus from the FULL, version-pinned documentation of execa@10 —
 * released AFTER the model's Jan-2026 cutoff.
 * The model cannot fall back on memorised knowledge, so a mutated doc actually
 * misleads it → mutants become detectable.
 *
 * The corpus is fetched at run time (the real docs, verbatim) and the mutation
 * engine injects mutants into it. The library is pinned to the documented
 * version in the sandbox (`packageOverrides`) so correct docs → working code
 * (gold passes) and mutated docs → broken code (mutant detected).
 */
import type { GoldCorpus } from "./goldCorpus.ts";

export interface PostCutoffCorpus {
    /** Display name of the corpus (e.g. "execa@10"). */
    name: string;
    /** npm package under test, pinned to `version` in the sandbox. */
    pkg: string;
    /** Version whose docs are fetched and mutated (released post-cutoff). */
    version: string;
    /** Raw base URL for the in-repo docs at the version tag. */
    docBaseUrl: string;
    /** Doc files (relative to docBaseUrl) forming the FULL documentation. */
    docFiles: string[];
    /** How many goals the gold baseline should generate/run. */
    maxGoals: number;
    /** Whether the library needs a network endpoint / is pure (informational). */
    pure: boolean;
}

export const POST_CUTOFF_CORPORA: Record<string, PostCutoffCorpus> = {
    // ── ACTIVE CORPUS ────────────────────────────────────────────────
    // marked 18.0.7 (2026-07, post-cutoff): a pure Markdown parser whose whole
    // API is a call plus an options object, so the planner's goals stay on the
    // mainstream surface and the gold baseline is attainable — the drift study
    // measured a 90% step-level baseline for this library, right at the ≥90%
    // gold-standard threshold this protocol requires.
    //
    // Chosen over execa@10 (kept below) after that corpus failed the gold
    // standard at 48%: with 16 doc files the planner drifts into the most exotic
    // corners of the API (IPC serialisation, stream transforms, pipe chains),
    // which the agent fails even on pristine documentation. A 73-mutant pool is
    // also tractable, where execa's 420 is not.
    marked: {
        name: "marked@18",
        pkg: "marked",
        version: "18.0.7",
        docBaseUrl: "https://raw.githubusercontent.com/markedjs/marked/v18.0.7/docs/",
        docFiles: ["USING_ADVANCED.md", "USING_PRO.md"],
        maxGoals: 8,
        pure: true,
    },

    // ── RETAINED FOR PROVENANCE ──────────────────────────────────────
    // Fails the gold standard with the current model (25% goals / 48% steps);
    // see the note above. Kept so the finding stays reproducible.
    execa: {
        name: "execa@10",
        pkg: "execa",
        version: "10.0.0",
        docBaseUrl: "https://raw.githubusercontent.com/sindresorhus/execa/v10.0.0/docs/",
        docFiles: [
            "execution.md",
            "scripts.md",
            "input.md",
            "output.md",
            "lines.md",
            "environment.md",
            "shell.md",
            "escaping.md",
            "errors.md",
            "termination.md",
            "pipe.md",
            "streams.md",
            "transform.md",
            "binary.md",
            "ipc.md",
            "api.md",
        ],
        maxGoals: 8,
        pure: true,
    },
};

/**
 * Fetch a post-cutoff library's full documentation and assemble it as a
 * GoldCorpus for mutation testing. `goals` is a length-only placeholder — the
 * planner generates the actual goals from the docs (only the count is used).
 */
export async function fetchMutationCorpus(key: string): Promise<
    PostCutoffCorpus & {
        corpus: GoldCorpus;
    }
> {
    const spec = POST_CUTOFF_CORPORA[key];
    if (!spec) {
        throw new Error(
            `Unknown mutation library "${key}". Available: ${
                Object.keys(POST_CUTOFF_CORPORA).join(", ")
            }`,
        );
    }
    const files: GoldCorpus["files"] = [];
    for (const rel of spec.docFiles) {
        const url = spec.docBaseUrl + rel;
        const res = await fetch(url, { headers: { "User-Agent": "rookie-eval/1.0" } });
        if (!res.ok) throw new Error(`Cannot fetch ${url}: HTTP ${res.status}`);
        const content = await res.text();
        if (content.length < 100) continue; // skip stubs
        files.push({
            filename: rel.replace(/\//g, "-"),
            mimetype: "text/markdown",
            content,
        });
    }
    if (files.length === 0) throw new Error(`No docs fetched for ${key}`);
    const corpus: GoldCorpus = {
        name: spec.name,
        files,
        goals: Array.from({ length: spec.maxGoals }, (_, i) => `goal-${i + 1}`),
    };
    return { ...spec, corpus };
}
