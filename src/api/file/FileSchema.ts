import { z } from "@hono/zod-openapi";

export const FileSchema = z
    .object({
        id: z.string().openapi({
            example: "file_clx123abc0000m8ols1234567",
            description: "Unique file identifier",
        }),
        filename: z.string().openapi({
            example: "requirements.pdf",
            description: "Original name of the file",
        }),
        mimetype: z.string().openapi({
            example: "application/pdf",
            description: "MIME type of the file",
        }),
        size: z.number().int().openapi({
            example: 1024768,
            description: "File size in bytes",
        }),
        createdAt: z.string().datetime().openapi({
            example: "2025-10-26T10:00:00.000Z",
            description: "File upload timestamp",
        }),
    })
    .openapi("File");

export const FileParamsSchema = z.object({
    id: z.string().min(1, "File ID is required").openapi({
        param: { name: "id", in: "path" },
        example: "file_clx123abc0000m8ols1234567",
        description: "File ID",
    }),
});

export const UploadFileRequestSchema = z.object({
    file: z.custom<File>((v) => v instanceof File)
        .openapi({
            type: "string",
            format: "binary",
        }),
});

export const FileIDsSchema = z.object({
    fileIds: z
        .array(z.string().min(1, "File ID cannot be empty"))
        .min(1, "You must provide at least one file ID")
        .openapi({
            example: ["file_id_abc", "file_id_xyz"],
            description: "An array of file IDs to associate/disassociate",
        }),
});

export const PaginatedFilesResponseSchema = z
    .object({
        files: z.array(FileSchema),
        meta: z.object({
            totalItems: z.number().int().openapi({ example: 100 }),
            totalPages: z.number().int().openapi({ example: 10 }),
            currentPage: z.number().int().openapi({ example: 1 }),
            itemsPerPage: z.number().int().openapi({ example: 10 }),
        }),
    })
    .openapi("PaginatedFilesResponse");

export const DeleteFileResponseSchema = z
    .object({
        id: z.string().openapi({
            example: "file_clx123abc0000m8ols1234567",
        }),
        message: z.string().openapi({
            example: "File deleted successfully",
        }),
    })
    .openapi("DeleteFileResponse");
