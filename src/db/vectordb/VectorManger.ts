import { QdrantClient } from "@qdrant/js-client-rest";

export class VectorConnection { // TODO make interface for vector db of this
    constructor(
        private _vectorClient: QdrantClient,
    ) {}
    public get vectorClient() {
        return this._vectorClient;
    }
}

export class VectorManager {
    static init(config: { host: string; port: number }): VectorConnection {
        const qdrantClient = new QdrantClient({
            host: config.host,
            port: config.port,
        });
        return new VectorConnection(qdrantClient);
    }
}
