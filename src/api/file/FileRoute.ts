import { createRoute } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import {
    DeleteFileResponseSchema,
    FileParamsSchema,
    FileSchema,
    PaginatedFilesResponseSchema,
    UploadFileRequestSchema,
    UploadManyFilesRequestSchema,
} from "./FileSchema.ts";
import { ErrorSchema, PaginationQuerySchema } from "../CommonSchema.ts";

const UploadFileRoute = createRoute({
    method: "post",
    path: "/files/upload",
    tags: ["Files"],
    summary: "Upload a new file (max 10MB)",
    request: {
        body: {
            content: {
                "multipart/form-data": {
                    schema: UploadFileRequestSchema,
                },
            },
            required: true,
        },
    },
    responses: {
        201: {
            description: "File uploaded successfully",
            content: { "application/json": { schema: FileSchema } },
        },
        400: {
            description: "Bad Request (e.g., no file, file too large)",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

const UploadManyFilesRoute = createRoute({
    method: "post",
    path: "/files/upload-many", // Zmieniona ścieżka
    tags: ["Files"],
    summary: "Upload multiple files (max 10MB total)",
    request: {
        body: {
            content: {
                "multipart/form-data": {
                    schema: UploadManyFilesRequestSchema,
                },
            },
            required: true,
        },
    },
    responses: {
        201: {
            description: "Files uploaded successfully",
            content: {
                "application/json": {
                    schema: z.array(FileSchema),
                },
            },
        },
        400: {
            description: "Bad Request (e.g., no files, total size too large)",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

const GetFileMetadataRoute = createRoute({
    method: "get",
    path: "/files/{id}/meta",
    tags: ["Files"],
    summary: "Get file metadata by ID",
    request: {
        params: FileParamsSchema,
    },
    responses: {
        200: {
            description: "File metadata",
            content: { "application/json": { schema: FileSchema } },
        },
        400: {
            description: "Bad Request",
            content: { "application/json": { schema: ErrorSchema } },
        },
        404: {
            description: "File not found",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

const DownloadFileRoute = createRoute({
    method: "get",
    path: "/files/{id}/download",
    tags: ["Files"],
    summary: "Download a file by ID",
    request: {
        params: FileParamsSchema,
    },
    responses: {
        200: {
            description: "The file content",
            content: {
                "application/octet-stream": {
                    schema: z.string(),
                },
            },
        },
        400: {
            description: "Bad Request",
            content: { "application/json": { schema: ErrorSchema } },
        },
        404: {
            description: "File not found",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

const DeleteFileRoute = createRoute({
    method: "delete",
    path: "/files/{id}",
    tags: ["Files"],
    summary: "Delete a file",
    description: "Deletes the file from storage and disassociates it from all projects.",
    request: {
        params: FileParamsSchema,
    },
    responses: {
        200: {
            description: "File deleted",
            content: { "application/json": { schema: DeleteFileResponseSchema } },
        },
        404: {
            description: "File not found",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

const ListFilesRoute = createRoute({
    method: "get",
    path: "/files",
    tags: ["Files"],
    summary: "List all file metadata (paginated)",
    request: {
        query: PaginationQuerySchema,
    },
    responses: {
        200: {
            description: "A paginated list of file metadata",
            content: { "application/json": { schema: PaginatedFilesResponseSchema } },
        },
        400: {
            description: "Bad Request (invalid pagination parameters)",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

export const FileRoutes = {
    UploadFileRoute,
    UploadManyFilesRoute,
    GetFileMetadataRoute,
    DownloadFileRoute,
    DeleteFileRoute,
    ListFilesRoute,
};
