import { createRoute } from "@hono/zod-openapi";
import { CreateProjectSchema, ProjectSchema } from "./ProjectSchema.ts";

export const CreateProjectRoute = createRoute({
    method: "post",
    path: "/projects",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: CreateProjectSchema,
                },
            },
            required: true,
        },
    },
    responses: {
        201: {
            description: "Project created",
            content: {
                "application/json": {
                    schema: ProjectSchema,
                },
            },
        },
    },
});
