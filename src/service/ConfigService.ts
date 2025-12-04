import * as path from "@std/path";
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
    };
    embeddings: {
        embeddingModel: string;
        vectorSize: number;
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
            },
            openAI: {
                apiKey: Deno.env.get("ROOKIE_OPEAN_AI_KEY") ||
                    "12345689ABCDEFG",
            },
        };
    }

    loadFile(filePath: string): void {
        try {
            const resolvedPath = path.resolve(Deno.cwd(), filePath);
            this.logger.log(`Searching for config file at ${resolvedPath}`);
            const fileContent = Deno.readTextFileSync(resolvedPath);
            const fileConfig = JSON.parse(fileContent) as Partial<ConfigValues>;
            this.config = { ...this.config, ...fileConfig };
            this.logger.log(`Configuration loaded from ${filePath}`);
        } catch {
            this.logger.log("No Config file loaded");
        }
    }

    get values(): ConfigValues {
        return this.config;
    }
}
