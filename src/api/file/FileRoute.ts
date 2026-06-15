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
    description: `Uploads a single documentation file (max 10 MB) and stores it; whitespace is \
normalised on ingest. The file is created **standalone** — it is not searchable until linked \
to a project (via \`POST /projects\` with \`fileIds\`, or \`POST /projects/{id}/files\`), at \
which point it is chunked and indexed. Send the file in a \`multipart/form-data\` body under \
the field name \`file\`.`,
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
    path: "/files/upload-many",
    tags: ["Files"],
    summary: "Upload multiple files (max 10MB total)",
    description:
        `Uploads several documentation files in one \`multipart/form-data\` request under the \
repeated field name \`files\`. The same per-file rules as \`/files/upload\` apply (10 MB each, \
whitespace normalised, created standalone). Returns the metadata of every created file in order.`,
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
    description:
        `Returns a file's metadata only — filename, MIME type, size in bytes, and timestamps. \
To retrieve the raw bytes use \`GET /files/{id}/download\`.`,
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
    description: `Streams the raw stored bytes of a file as an attachment (\`Content-Disposition: \
attachment\`) with the original filename and MIME type. For documentation crawled from a URL \
this is the extracted Markdown.`,
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
    description:
        `Permanently deletes the file from storage and removes it everywhere it is used: for \
every project that references the file, its vectors are deleted from that project's Qdrant \
collection, and the file is disassociated from all projects. This cannot be undone.`,
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
    description:
        `Returns a paginated list of all stored files' metadata (no contents), across every \
project and including unlinked standalone files. Use \`page\` and \`limit\` to page through; the \
\`meta\` block reports total counts.`,
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
