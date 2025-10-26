import type { RouteHandler } from "@hono/zod-openapi";
import { Controller, Delete, Get, Post } from "../Decorator.ts";
import { FileService } from "../../service/FileService.ts";
import { FileConverter } from "./FileConverter.ts";
import * as types from "../../types/index.ts";
import { FileRoutes } from "./FileRoute.ts";
import { Buffer } from "node:buffer";

@Controller("/files")
export class FileController {
    constructor(
        private fileService: FileService,
        private fileConverter: FileConverter,
    ) {}

    @Post(FileRoutes.UploadFileRoute)
    uploadFile: RouteHandler<typeof FileRoutes.UploadFileRoute> = async (c) => {
        const formData = await c.req.formData();
        const file = formData.get("file");

        if (!(file instanceof File)) {
            return c.json({ code: 400, message: "No 'file' field in form-data" }, 400);
        }

        try {
            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const dbMetadata = await this.fileService.uploadFile(file, buffer);
            const apiFile = this.fileConverter.mapDbFileToApi(dbMetadata);

            return c.json(apiFile, 201);
        } catch (error: any) {
            return c.json({ code: 400, message: error.message }, 400);
        }
    };

    @Get(FileRoutes.GetFileMetadataRoute)
    getFileMetadata: RouteHandler<typeof FileRoutes.GetFileMetadataRoute> = async (c) => {
        const { id } = c.req.valid("param");
        const dbMetadata = await this.fileService.getFileMetadata(id as types.file.FileId);

        if (!dbMetadata) {
            return c.json({ code: 404, message: "File not found" }, 404);
        }

        const apiFile = this.fileConverter.mapDbFileToApi(dbMetadata);
        return c.json(apiFile, 200); // 3. Send converted data
    };

    @Get(FileRoutes.DownloadFileRoute)
    downloadFile: RouteHandler<typeof FileRoutes.DownloadFileRoute> = async (c) => {
        const { id } = c.req.valid("param");
        const result = await this.fileService.downloadFile(id as types.file.FileId);

        if (!result) {
            return c.json({ code: 404, message: "File not found" }, 404);
        }

        const { metadata: dbMetadata, buffer } = result;
        const apiMetadata = this.fileConverter.mapDbFileToApi(dbMetadata);
        const headers = new Headers();
        headers.set("Content-Type", apiMetadata.mimetype);
        headers.set("Content-Disposition", `attachment; filename="${apiMetadata.filename}"`);
        headers.set("Content-Length", apiMetadata.size.toString());

        return new Response(buffer, {
            status: 200,
            headers: headers,
        });
    };

    @Delete(FileRoutes.DeleteFileRoute)
    deleteFile: RouteHandler<typeof FileRoutes.DeleteFileRoute> = async (c) => {
        const { id } = c.req.valid("param");
        const success = await this.fileService.deleteFile(id as types.file.FileId);
        if (!success) {
            return c.json({ code: 404, message: "File not found" }, 404);
        }
        return c.json({ id: id, message: "File deleted successfully" }, 200);
    };

    @Get(FileRoutes.ListFilesRoute)
    listFiles: RouteHandler<typeof FileRoutes.ListFilesRoute> = async (c) => {
        const { page, limit } = c.req.valid("query");
        const dbPaginatedResponse = await this.fileService.listFiles({ page, limit });
        const apiFiles = dbPaginatedResponse.files.map((dbFile) =>
            this.fileConverter.mapDbFileToApi(dbFile)
        );
        return c.json({
            files: apiFiles,
            meta: dbPaginatedResponse.meta,
        }, 200);
    };
}
