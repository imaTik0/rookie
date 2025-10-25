import type { RouteHandler } from "@hono/zod-openapi";
import { Controller, Post } from "../Decorator.ts";
import { CreateUserRoute } from "./UserRoute.ts";

@Controller("/users")
export class UserController {
    private users: any[] = [];

    @Post(CreateUserRoute)
    createUser: RouteHandler<typeof CreateUserRoute> = (c) => {
        const newUserDto = c.req.valid("json");
        const newUser = {
            id: `user-${Math.random().toString(36).slice(2)}`,
            ...newUserDto,
        };
        this.users.push(newUser);
        return c.json(newUser, 201);
    };
}
