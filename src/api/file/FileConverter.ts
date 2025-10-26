import * as db from "../../db/mongo/Model.ts";
import { z } from "zod";
import { FileSchema } from "./FileSchema.ts";

export class FileConverter {
    public mapDbFileToApi(dbFile: Omit<db.File, "data">): z.infer<typeof FileSchema> {
        return {
            id: dbFile._id,
            filename: dbFile.filename,
            mimetype: dbFile.mimetype,
            size: dbFile.size,
            createdAt: dbFile.createdAt.toISOString(),
        };
    }
}
