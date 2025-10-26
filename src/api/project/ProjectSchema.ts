import { z } from "@hono/zod-openapi";
import { FileSchema } from "../file/FileSchema.ts";

export const ProjectSchema = z
    .object({
        id: z.string().openapi({
            example: "proj_clx123abc0000m8ols1234567",
            description: "Unique project identifier",
        }),
        projectName: z.string().min(3, "Name must be at least 3 characters").openapi({
            example: "Project 'Phoenix'",
            description: "The name of the project",
        }),
        files: z.array(FileSchema).openapi({
            description: "List of file metadata associated with the project",
        }),
        createdAt: z.string().datetime().openapi({
            example: "2025-10-26T10:00:00.000Z",
            description: "Creation timestamp",
        }),
        updatedAt: z.string().datetime().openapi({
            example: "2025-10-26T10:00:00.000Z",
            description: "Last update timestamp",
        }),
    })
    .openapi("Project");

export const CreateProjectSchema = z
    .object({
        projectName: z.string().min(3, "Name must be at least 3 characters"),
        fileIds: z
            .array(z.string().openapi({ example: "file_clx123abc..." }))
            .optional()
            .openapi({
                description: "Optional array of existing file IDs to link",
            }),
    })
    .openapi("CreateProject");

export const UpdateProjectSchema = CreateProjectSchema.partial().openapi(
    "UpdateProject",
);

export const ParamsSchema = z.object({
    id: z.string().min(1, "Project ID is required").openapi({
        param: { name: "id", in: "path" },
        example: "proj_clx123abc0000m8ols1234567",
        description: "Project ID",
    }),
});

export const PaginatedProjectsResponseSchema = z
    .object({
        projects: z.array(ProjectSchema),
        meta: z.object({
            totalItems: z.number().int().openapi({ example: 100 }),
            totalPages: z.number().int().openapi({ example: 10 }),
            currentPage: z.number().int().openapi({ example: 1 }),
            itemsPerPage: z.number().int().openapi({ example: 10 }),
        }),
    })
    .openapi("PaginatedProjectsResponse");

export const DeleteProjectResponseSchema = z
    .object({
        id: z.string().openapi({
            example: "proj_clx123abc0000m8ols1234567",
        }),
        message: z.string().openapi({
            example: "Project deleted",
        }),
    })
    .openapi("DeleteProjectResponse");
