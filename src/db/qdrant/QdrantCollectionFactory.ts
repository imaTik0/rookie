import { QdrantCollection } from "./QdrantCollection.ts";
import { QdrantConnection } from "./QdrantManger.ts";

export class QdrantCollectionFactory {

    constructor(
        private qdrantConnection: QdrantConnection,
    ) {}

    async createCollection<T>(name: string, vectorSize: number): Promise<QdrantCollection<T>> {
        await this.ensureCollectionExists(name, vectorSize);
        return new QdrantCollection(this.qdrantConnection, name);
    }

    private async ensureCollectionExists(name: string, vectorSize: number) {
        const { collections } = await this.qdrantConnection.qdrantClient.getCollections();
        const collectionExists = collections.some(c => c.name === name);
        if (collectionExists) {
            return;
        }
        await this.qdrantConnection.qdrantClient.recreateCollection(name, {
            vectors: {
                size: vectorSize,
                distance: "Cosine",
            },
        });
    }
}