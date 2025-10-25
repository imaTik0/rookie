import type { RouteHandler } from "@hono/zod-openapi";
import { Controller, Post } from "../Decorator.ts";
import { CreateProjectRoute } from "./ProjectRoute.ts";
import { Executor } from "../../service/Executor.ts";

@Controller("/projects")
export class ProjectController {

    constructor(
        private executor: Executor
    ) {}

    @Post(CreateProjectRoute)
    createProject: RouteHandler<typeof CreateProjectRoute> = (c) => {
        const newUserDto = c.req.valid("json");
        console.log(this.executor)
        const newUser = {
            id: `user-${Math.random().toString(36).slice(2)}`,
            ...newUserDto,
        };
        return c.json(newUser, 201);
    };
}
