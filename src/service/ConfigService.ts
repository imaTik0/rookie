import { Logger } from "../Logger.ts";

export interface ConfigValues {
    port: number;
    host: string;
    mongoDb: {
        url: string;
        dbName: string;
    };
    qdrantVectorDb: {
        host: string;
        port: number;
    };
    openAI: {
        apiKey: string;
        baseURL?: string;
        modelName: string;
    };
    embeddings: {
        embeddingModel: string;
        vectorSize: number;
        baseURL?: string;
    };
    limits: {
        maxResearchIterations: number;
        maxVerificationIterations: number;
        defaultSearchLimit: number;
        relatedDocsLimit: number;
        maxResultChars: number;
        maxContextChars: number;
        maxScenarioDocsChars: number;
        /** Token budget for the agentic loop before non-destructive pruning kicks in. */
        maxContextTokens: number;
        /** Max chars returned by a single VFS read_file before truncation. */
        maxFileReadChars: number;
    };
    /** Generation/determinism knobs. Kept conservative so small local models behave predictably. */
    llm: {
        temperature: number;
        /** Optional integer seed; ignored by servers that do not support it (harmless). */
        seed?: number;
        /**
         * How structured JSON is requested from the model.
         * - "json_schema": strict schema (OpenAI / newer servers). Most accurate.
         * - "json_object": loose JSON mode (widely supported, incl. Ollama/llama.cpp). Default.
         * - "text": no response_format; rely on prompt + zod repair (oldest/smallest models).
         */
        structuredOutputMode: "json_schema" | "json_object" | "text";
        /** Extra repair attempts when the model returns JSON that fails zod validation. */
        maxRepairAttempts: number;
        /** Retries (with exponential backoff) on transient 429/5xx/network errors. */
        maxRetries: number;
        retryBaseMs: number;
        /** Per-call timeout (ms) for a single LLM completion. Guards against hangs;
         *  set generously for slow local models doing large generations. */
        callTimeoutMs: number;
    };
    /** BM25 sparse-vector parameters (Qdrant applies IDF server-side). */
    sparse: {
        k1: number;
        b: number;
        /** Approximate average document length in tokens (FastEmbed-style, avoids global stats). */
        avgLen: number;
    };
    /** Document chunking parameters. Changing these requires re-indexing all projects. */
    chunking: {
        chunkSize: number;
        chunkOverlap: number;
    };
    /** HTML-to-Markdown crawler thresholds. */
    crawler: {
        /** Below this body text length + an SPA root marker ⇒ treat as unrendered JS shell. */
        spaMinTextChars: number;
        /** Below this Readability article length ⇒ fall back to direct main/body extraction. */
        readabilityMinChars: number;
    };
    /** Reranking of retrieved chunks. Defaults to LLM-based reranking (no extra service needed). */
    reranker: {
        mode: "off" | "llm" | "api";
        /** For "api" mode: a Jina/TEI-compatible /rerank endpoint. */
        baseURL?: string;
        apiKey?: string;
        model?: string;
        /** Rerank this many top candidates, then keep `limit`. */
        topN: number;
    };
    /** Failure classifier self-consistency. */
    classifier: {
        /** Number of independent classifications; majority vote. 1 = legacy behaviour. */
        votes: number;
    };
    /** Master-plan concurrency. */
    planner: {
        /**
         * How many goals to run concurrently inside runMasterPlan / rerunMasterPlan.
         * 1 = fully sequential (default, safest for rate-limited LLM endpoints).
         * 2–4 = good balance for most hosted APIs.
         * Set equal to maxGoals for maximum throughput at the cost of KB cross-pollination.
         */
        parallelGoals: number;
    };
    /** Untrusted-code sandbox controls. */
    sandbox: {
        /** Apply container hardening flags (non-root, cap-drop, read-only, etc.). */
        hardening: boolean;
        /** Numeric user[:group] to run as. Empty string keeps the image default. */
        user: string;
        pidsLimit: number;
        /** "network" (default rookie-network), "none" (offline), or a named network. */
        networkMode: string;
        networkName: string;
        /** Auto `npm install` of bare imports detected in generated code. */
        autoInstallDeps: boolean;
        /** Per-step Docker execution timeout in milliseconds (default 60 000). */
        stepTimeoutMs: number;
    };
}

function envBool(name: string, fallback: boolean): boolean {
    const v = Deno.env.get(name);
    if (v === undefined) return fallback;
    return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function envNum(name: string, fallback: number): number {
    const v = Deno.env.get(name);
    if (v === undefined || v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

export class ConfigService {
    private config: ConfigValues;
    constructor(
        private logger: Logger,
    ) {
        this.config = {
            host: Deno.env.get("ROOKIE_HOST") || "localhost",
            port: Number.parseInt(Deno.env.get("ROOKIE_PORT") || "3000", 10),
            mongoDb: {
                dbName: Deno.env.get("ROOKIE_MONGO_DB_NAME") || "rookie_db",
                url: Deno.env.get("ROOKIE_MONGO_DB_URL") ||
                    "mongodb://localhost:27017",
            },
            qdrantVectorDb: {
                host: Deno.env.get("ROOKIE_QDRANT_HOST") || "127.0.0.1",
                port: Number.parseInt(
                    Deno.env.get("ROOKIE_QDRANT_PORT") || "6333",
                    10,
                ),
            },
            embeddings: {
                // Local-friendly default: served via an OpenAI-compatible endpoint
                // (e.g. Ollama `nomic-embed-text`). Stronger on technical text than MiniLM.
                embeddingModel: Deno.env.get("ROOKIE_EMBEDDING_MODEL") ||
                    "nomic-embed-text",
                vectorSize: Number.parseInt(
                    Deno.env.get("ROOKIE_EMBEDDING_VECTOR_SIZE") || "768",
                    10,
                ),
                baseURL: Deno.env.get("ROOKIE_EMBEDDING_BASE_URL"),
            },
            openAI: {
                // Accept the correctly-spelled var first, fall back to the historical typo.
                apiKey: Deno.env.get("ROOKIE_OPENAI_KEY") ||
                    Deno.env.get("ROOKIE_OPEAN_AI_KEY") ||
                    "12345689ABCDEFG",
                baseURL: Deno.env.get("ROOKIE_OPENAI_BASE_URL"),
                modelName: Deno.env.get("ROOKIE_OPENAI_MODEL_NAME") || "gpt-4o-mini",
            },
            limits: {
                maxResearchIterations: Number.parseInt(Deno.env.get("ROOKIE_MAX_RESEARCH_ITERATIONS") || "5", 10),
                maxVerificationIterations: Number.parseInt(Deno.env.get("ROOKIE_MAX_VERIFICATION_ITERATIONS") || "5", 10),
                defaultSearchLimit: Number.parseInt(Deno.env.get("ROOKIE_DEFAULT_SEARCH_LIMIT") || "10", 10),
                relatedDocsLimit: Number.parseInt(Deno.env.get("ROOKIE_RELATED_DOCS_LIMIT") || "25", 10),
                maxResultChars: Number.parseInt(Deno.env.get("ROOKIE_MAX_RESULT_CHARS") || "3000", 10),
                maxContextChars: Number.parseInt(Deno.env.get("ROOKIE_MAX_CONTEXT_CHARS") || "50000", 10),
                maxScenarioDocsChars: Number.parseInt(Deno.env.get("ROOKIE_MAX_SCENARIO_DOCS_CHARS") || "100000", 10),
                maxContextTokens: envNum("ROOKIE_MAX_CONTEXT_TOKENS", 12000),
                maxFileReadChars: envNum("ROOKIE_MAX_FILE_READ_CHARS", 16000),
            },
            llm: {
                temperature: envNum("ROOKIE_LLM_TEMPERATURE", 0.2),
                seed: Deno.env.get("ROOKIE_LLM_SEED") ? envNum("ROOKIE_LLM_SEED", 0) : undefined,
                structuredOutputMode:
                    (Deno.env.get("ROOKIE_STRUCTURED_OUTPUT_MODE") as
                        | "json_schema"
                        | "json_object"
                        | "text") || "json_object",
                maxRepairAttempts: envNum("ROOKIE_LLM_MAX_REPAIR_ATTEMPTS", 1),
                maxRetries: envNum("ROOKIE_LLM_MAX_RETRIES", 3),
                retryBaseMs: envNum("ROOKIE_LLM_RETRY_BASE_MS", 500),
                callTimeoutMs: envNum("ROOKIE_LLM_CALL_TIMEOUT_MS", 300_000),
            },
            sparse: {
                k1: envNum("ROOKIE_BM25_K1", 1.5),
                b: envNum("ROOKIE_BM25_B", 0.75),
                avgLen: envNum("ROOKIE_BM25_AVG_LEN", 256),
            },
            chunking: {
                chunkSize: envNum("ROOKIE_CHUNK_SIZE", 1200),
                chunkOverlap: envNum("ROOKIE_CHUNK_OVERLAP", 150),
            },
            crawler: {
                spaMinTextChars: envNum("ROOKIE_SPA_MIN_TEXT_CHARS", 200),
                readabilityMinChars: envNum("ROOKIE_READABILITY_MIN_CHARS", 250),
            },
            reranker: {
                mode: (Deno.env.get("ROOKIE_RERANKER_MODE") as "off" | "llm" | "api") || "llm",
                baseURL: Deno.env.get("ROOKIE_RERANKER_BASE_URL"),
                apiKey: Deno.env.get("ROOKIE_RERANKER_API_KEY"),
                model: Deno.env.get("ROOKIE_RERANKER_MODEL"),
                topN: envNum("ROOKIE_RERANKER_TOP_N", 20),
            },
            classifier: {
                votes: Math.max(1, envNum("ROOKIE_CLASSIFIER_VOTES", 3)),
            },
            planner: {
                parallelGoals: Math.max(1, envNum("ROOKIE_PARALLEL_GOALS", 1)),
            },
            sandbox: {
                hardening: envBool("ROOKIE_SANDBOX_HARDENING", true),
                user: Deno.env.get("ROOKIE_SANDBOX_USER") ?? "1000:1000",
                pidsLimit: envNum("ROOKIE_SANDBOX_PIDS_LIMIT", 256),
                networkMode: Deno.env.get("ROOKIE_SANDBOX_NETWORK_MODE") || "network",
                networkName: Deno.env.get("ROOKIE_SANDBOX_NETWORK_NAME") || "rookie-network",
                autoInstallDeps: envBool("ROOKIE_SANDBOX_AUTO_INSTALL_DEPS", true),
                stepTimeoutMs: envNum("ROOKIE_SANDBOX_STEP_TIMEOUT_MS", 60_000),
            },
        };
    }



    get values(): ConfigValues {
        return this.config;
    }
}
