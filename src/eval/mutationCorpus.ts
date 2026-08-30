import type { GoldCorpus } from "./goldCorpus.ts";

export interface PostCutoffCorpus {
    name: string;
    pkg: string;
    version: string;
    docBaseUrl: string;
    docFiles: string[];
    maxGoals: number;
    pure: boolean;
}

export const POST_CUTOFF_CORPORA: Record<string, PostCutoffCorpus> = {
    marked: {
        name: "marked@18",
        pkg: "marked",
        version: "18.0.7",
        docBaseUrl: "https://raw.githubusercontent.com/markedjs/marked/v18.0.7/docs/",
        docFiles: ["USING_ADVANCED.md", "USING_PRO.md"],
        maxGoals: 8,
        pure: true,
    },

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
        if (content.length < 100) continue;
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
