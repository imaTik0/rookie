import { ConfigService } from "../../service/ConfigService.ts";
import { FileShard } from "../../types/file.ts";
import { VectorCollection } from "./VectorCollection.ts";
import { VectorConnection } from "./VectorManger.ts";

export class VectorCollectionFactory {
    private existingCollections = new Set<string>();

    constructor(
        private vectorConnection: VectorConnection,
        private configService: ConfigService,
    ) {}

    async createCollection<T = FileShard>(
        name: string,
        vectorSize?: number,
    ): Promise<VectorCollection<T>> {
        await this.ensureCollectionExists(
            name,
            vectorSize || this.configService.values.embeddings.vectorSize,
        );
        return new VectorCollection(this.vectorConnection, name);
    }

    private async ensureCollectionExists(name: string, vectorSize: number) {
        if (this.existingCollections.has(name)) {
            return;
        }

        try {
            const { collections } = await this.vectorConnection.vectorClient
                .getCollections();

            const collectionExists = collections.some((c) => c.name === name);
            if (collectionExists) {
                this.existingCollections.add(name);
                return;
            }

            await this.vectorConnection.vectorClient.createCollection(name, {
                vectors: {
                    dense: {
                        size: vectorSize,
                        distance: "Cosine",
                    }
                },
                sparse_vectors: {
                    sparse: {}
                }
            });

            this.existingCollections.add(name);
        } catch (error) {
            const err = error as { status?: number; message?: string };
            if (err?.status === 409 || err?.message?.includes("Conflict")) {
                this.existingCollections.add(name);
                return;
            }
            throw error;
        }
    }
}
