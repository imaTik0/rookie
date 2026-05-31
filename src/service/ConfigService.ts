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
    };
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
                embeddingModel: Deno.env.get("ROOKIE_EMBEDDING_MODEL") ||
                    "Xenova/all-MiniLM-L6-v2",
                vectorSize: Number.parseInt(
                    Deno.env.get("ROOKIE_EMBEDDING_VECTOR_SIZE") || "384",
                    10,
                ),
                baseURL: Deno.env.get("ROOKIE_EMBEDDING_BASE_URL"),
            },
            openAI: {
                apiKey: Deno.env.get("ROOKIE_OPEAN_AI_KEY") ||
                    "12345689ABCDEFG",
                baseURL: Deno.env.get("ROOKIE_OPENAI_BASE_URL"),
                modelName: Deno.env.get("ROOKIE_OPENAI_MODEL_NAME") || "gpt-5.4",
            },
            limits: {
                maxResearchIterations: Number.parseInt(Deno.env.get("ROOKIE_MAX_RESEARCH_ITERATIONS") || "5", 10),
                maxVerificationIterations: Number.parseInt(Deno.env.get("ROOKIE_MAX_VERIFICATION_ITERATIONS") || "5", 10),
                defaultSearchLimit: Number.parseInt(Deno.env.get("ROOKIE_DEFAULT_SEARCH_LIMIT") || "10", 10),
                relatedDocsLimit: Number.parseInt(Deno.env.get("ROOKIE_RELATED_DOCS_LIMIT") || "25", 10),
                maxResultChars: Number.parseInt(Deno.env.get("ROOKIE_MAX_RESULT_CHARS") || "3000", 10),
                maxContextChars: Number.parseInt(Deno.env.get("ROOKIE_MAX_CONTEXT_CHARS") || "50000", 10),
                maxScenarioDocsChars: Number.parseInt(Deno.env.get("ROOKIE_MAX_SCENARIO_DOCS_CHARS") || "100000", 10),
            },
        };
    }



    get values(): ConfigValues {
        return this.config;
    }
}
