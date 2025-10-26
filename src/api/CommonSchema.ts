import { z } from "@hono/zod-openapi";

export const ErrorSchema = z
    .object({
        code: z.number().int().openapi({ example: 404 }),
        message: z.string().openapi({ example: "Resource not found" }),
    })
    .openapi("Error");

export const PaginationQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1).openapi({
        param: { name: "page", in: "query" },
        example: 1,
        description: "Page number",
    }),
    limit: z.coerce.number().int().min(1).max(100).default(10).openapi({
        param: { name: "limit", in: "query" },
        example: 10,
        description: "Number of results per page (max 100)",
    }),
});
