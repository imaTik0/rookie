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
        projectName: z.string().min(3, "Name must be at least 3 characters").openapi({
            example: "Stripe API Docs",
            description: "Human-readable project name (minimum 3 characters).",
        }),
        fileIds: z
            .array(z.string().openapi({ example: "file_clx123abc..." }))
            .optional()
            .openapi({
                description:
                    "Optional IDs of already-uploaded files to link and index into the " +
                    "project's vector collection on creation. Files must already exist " +
                    "(upload via `POST /files/upload`).",
            }),
    })
    .openapi("CreateProject");

export const UpdateProjectSchema = CreateProjectSchema.partial().openapi(
    "UpdateProject",
);

export const CreateProjectFromUrlSchema = z
    .object({
        projectName: z.string().min(3, "Name must be at least 3 characters").openapi({
            example: "Docs Project",
            description: "Human-readable project name (minimum 3 characters).",
        }),
        url: z.string().url().openapi({
            example: "https://docs.example.com",
            description:
                "Documentation entry-point URL to ingest. If the origin serves an " +
                "`llms-full.txt` it is used directly; otherwise same-origin pages are " +
                "crawled from this URL.",
        }),
        maxPages: z.number().int().min(1).max(200).optional().default(50).openapi({
            example: 50,
            description:
                "Maximum number of pages to crawl (1–200). Ignored when an " +
                "`llms-full.txt` is found. Larger values mean longer crawl times.",
        }),
    })
    .openapi("CreateProjectFromUrl");

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

export type ProjectSchema = z.infer<typeof ProjectSchema>;
export type CreateProjectSchema = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectSchema = z.infer<typeof UpdateProjectSchema>;
export type ParamsSchema = z.infer<typeof ParamsSchema>;
export type PaginatedProjectsResponseSchema = z.infer<typeof PaginatedProjectsResponseSchema>;
export type DeleteProjectResponseSchema = z.infer<typeof DeleteProjectResponseSchema>;
