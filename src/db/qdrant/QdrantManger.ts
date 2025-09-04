
import { QdrantClient } from "@qdrant/js-client-rest";

export class QdrantConnection {
    constructor(
        private _qdrantClient: QdrantClient,
    ) {}
    public get qdrantClient() {
      return this._qdrantClient;
    }
}

export class QdrantManager {
    static init(config: { host: string, port: number }): QdrantConnection {
        const qdrantClient = new QdrantClient({host: config.host, port: config.port});
        return new QdrantConnection(qdrantClient);
    }
}