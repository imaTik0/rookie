import { ConfigService } from "../../service/ConfigService.ts";
import { FileShard } from "../../types/file.ts";
import { VectorCollection } from "./VectorCollection.ts";
import { VectorConnection } from "./VectorManger.ts";

export class VectorCollectionFactory {
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
        try {
            const { collections } = await this.vectorConnection.vectorClient
                .getCollections();

            const collectionExists = collections.some((c) => c.name === name);
            if (collectionExists) return;

            await this.vectorConnection.vectorClient.createCollection(name, {
                vectors: {
                    size: vectorSize,
                    distance: "Cosine",
                },
            });
        } catch (error: any) {
            if (error?.status === 409 || error?.message?.includes("Conflict")) {
                return;
            }
            throw error;
        }
    }
}
