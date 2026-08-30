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

export const PaginationMetaSchema = z
    .object({
        totalItems: z.number().int().openapi({ example: 100 }),
        totalPages: z.number().int().openapi({ example: 10 }),
        currentPage: z.number().int().openapi({ example: 1 }),
        itemsPerPage: z.number().int().openapi({ example: 10 }),
    })
    .openapi("PaginationMeta");

export function paginated<T extends z.ZodType>(itemSchema: T) {
    return z.object({
        items: z.array(itemSchema),
        meta: PaginationMetaSchema,
    });
}

export function buildMeta(
    total: number,
    page: number,
    limit: number,
): z.infer<typeof PaginationMetaSchema> {
    return {
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        currentPage: page,
        itemsPerPage: limit,
    };
}

export function errorBody(error: unknown, code = 400): { code: number; message: string } {
    const err = error as { message?: string };
    return { code, message: err?.message || "Unknown error" };
}

export type ErrorSchema = z.infer<typeof ErrorSchema>;
export type PaginationQuerySchema = z.infer<typeof PaginationQuerySchema>;
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;
