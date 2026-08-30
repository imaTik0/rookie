import { Injectable } from "../ioc/decorator.ts";
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
        maxContextTokens: number;
        maxFileReadChars: number;
    };
    llm: {
        temperature: number;
        seed?: number;
        structuredOutputMode: "json_schema" | "json_object" | "text";
        maxRepairAttempts: number;
        maxRetries: number;
        retryBaseMs: number;
        callTimeoutMs: number;
        maxTokens: number;
    };
    sparse: {
        k1: number;
        b: number;
        avgLen: number;
    };
    chunking: {
        chunkSize: number;
        chunkOverlap: number;
    };
    crawler: {
        spaMinTextChars: number;
        readabilityMinChars: number;
    };
    reranker: {
        mode: "off" | "llm" | "api";
        baseURL?: string;
        apiKey?: string;
        model?: string;
        topN: number;
    };
    classifier: {
        votes: number;
    };
    planner: {
        parallelGoals: number;
    };
    sandbox: {
        hardening: boolean;
        user: string;
        pidsLimit: number;
        networkMode: string;
        networkName: string;
        autoInstallDeps: boolean;
        stepTimeoutMs: number;
        installTimeoutMs: number;
        maxConcurrentContainers: number;
        memoryLimit: string;
        requireGroundedSuccess: boolean;
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

@Injectable()
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
                embeddingModel: Deno.env.get("ROOKIE_EMBEDDING_MODEL") ||
                    "nomic-embed-text",
                vectorSize: Number.parseInt(
                    Deno.env.get("ROOKIE_EMBEDDING_VECTOR_SIZE") || "768",
                    10,
                ),
                baseURL: Deno.env.get("ROOKIE_EMBEDDING_BASE_URL"),
            },
            openAI: {
                apiKey: Deno.env.get("ROOKIE_OPENAI_KEY") ||
                    Deno.env.get("ROOKIE_OPEAN_AI_KEY") ||
                    "12345689ABCDEFG",
                baseURL: Deno.env.get("ROOKIE_OPENAI_BASE_URL"),
                modelName: Deno.env.get("ROOKIE_OPENAI_MODEL_NAME") || "gpt-4o-mini",
            },
            limits: {
                maxResearchIterations: Number.parseInt(
                    Deno.env.get("ROOKIE_MAX_RESEARCH_ITERATIONS") || "3",
                    10,
                ),
                maxVerificationIterations: Number.parseInt(
                    Deno.env.get("ROOKIE_MAX_VERIFICATION_ITERATIONS") || "3",
                    10,
                ),
                defaultSearchLimit: Number.parseInt(
                    Deno.env.get("ROOKIE_DEFAULT_SEARCH_LIMIT") || "10",
                    10,
                ),
                relatedDocsLimit: Number.parseInt(
                    Deno.env.get("ROOKIE_RELATED_DOCS_LIMIT") || "25",
                    10,
                ),
                maxResultChars: Number.parseInt(
                    Deno.env.get("ROOKIE_MAX_RESULT_CHARS") || "3000",
                    10,
                ),
                maxContextChars: Number.parseInt(
                    Deno.env.get("ROOKIE_MAX_CONTEXT_CHARS") || "30000",
                    10,
                ),
                maxScenarioDocsChars: Number.parseInt(
                    Deno.env.get("ROOKIE_MAX_SCENARIO_DOCS_CHARS") || "100000",
                    10,
                ),
                maxContextTokens: envNum("ROOKIE_MAX_CONTEXT_TOKENS", 64000),
                maxFileReadChars: envNum("ROOKIE_MAX_FILE_READ_CHARS", 16000),
            },
            llm: {
                temperature: envNum("ROOKIE_LLM_TEMPERATURE", 0.2),
                seed: Deno.env.get("ROOKIE_LLM_SEED") ? envNum("ROOKIE_LLM_SEED", 0) : undefined,
                structuredOutputMode: (Deno.env.get("ROOKIE_STRUCTURED_OUTPUT_MODE") as
                    | "json_schema"
                    | "json_object"
                    | "text") || "json_object",
                maxRepairAttempts: envNum("ROOKIE_LLM_MAX_REPAIR_ATTEMPTS", 1),
                maxRetries: envNum("ROOKIE_LLM_MAX_RETRIES", 3),
                retryBaseMs: envNum("ROOKIE_LLM_RETRY_BASE_MS", 500),
                callTimeoutMs: envNum("ROOKIE_LLM_CALL_TIMEOUT_MS", 300_000),
                maxTokens: envNum("ROOKIE_LLM_MAX_TOKENS", 8192),
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
                mode: (Deno.env.get("ROOKIE_RERANKER_MODE") as "off" | "llm" | "api") || "off",
                baseURL: Deno.env.get("ROOKIE_RERANKER_BASE_URL"),
                apiKey: Deno.env.get("ROOKIE_RERANKER_API_KEY"),
                model: Deno.env.get("ROOKIE_RERANKER_MODEL"),
                topN: envNum("ROOKIE_RERANKER_TOP_N", 20),
            },
            classifier: {
                votes: Math.max(1, envNum("ROOKIE_CLASSIFIER_VOTES", 3)),
            },
            planner: {
                parallelGoals: Math.max(1, envNum("ROOKIE_PARALLEL_GOALS", 4)),
            },
            sandbox: {
                hardening: envBool("ROOKIE_SANDBOX_HARDENING", true),
                user: Deno.env.get("ROOKIE_SANDBOX_USER") ?? "1000:1000",
                pidsLimit: envNum("ROOKIE_SANDBOX_PIDS_LIMIT", 256),
                networkMode: Deno.env.get("ROOKIE_SANDBOX_NETWORK_MODE") || "network",
                networkName: Deno.env.get("ROOKIE_SANDBOX_NETWORK_NAME") || "rookie-network",
                autoInstallDeps: envBool("ROOKIE_SANDBOX_AUTO_INSTALL_DEPS", true),
                stepTimeoutMs: envNum("ROOKIE_SANDBOX_STEP_TIMEOUT_MS", 60_000),
                installTimeoutMs: envNum("ROOKIE_SANDBOX_INSTALL_TIMEOUT_MS", 180_000),
                maxConcurrentContainers: Math.max(
                    1,
                    envNum("ROOKIE_SANDBOX_MAX_CONCURRENT", 4),
                ),
                memoryLimit: Deno.env.get("ROOKIE_SANDBOX_MEMORY_LIMIT") || "512m",
                requireGroundedSuccess: envBool("ROOKIE_SANDBOX_REQUIRE_GROUNDED_SUCCESS", true),
            },
        };
    }

    get values(): ConfigValues {
        return this.config;
    }
}
