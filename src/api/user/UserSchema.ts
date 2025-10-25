import { z } from "@hono/zod-openapi";

export const UserSchema = z.object({
    id: z.string().openapi({
        example: "",
    }),
    name: z.string().openapi({
        example: "John Doe",
    }),
    age: z.number().int().openapi({
        example: 42,
    }),
});

export const CreateUserSchema = UserSchema.omit({ id: true });
