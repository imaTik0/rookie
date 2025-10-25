import { createRoute } from "@hono/zod-openapi";
import { CreateUserSchema, UserSchema } from "./UserSchema.ts";

export const CreateUserRoute = createRoute({
    method: "post",
    path: "/users",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: CreateUserSchema,
                },
            },
            required: true,
        },
    },
    responses: {
        201: {
            description: "User created",
            content: {
                "application/json": {
                    schema: UserSchema,
                },
            },
        },
    },
});
