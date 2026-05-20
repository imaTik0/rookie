import type { RouteHandler } from "@hono/zod-openapi";
import { Controller, Post } from "../Decorator.ts";
import { PlannerService } from "../../service/PlannerService.ts";
import * as types from "../../types/index.ts";
import { PlannerRoutes } from "./PlannerRoute.ts";

@Controller("/planner")
export class PlannerController {
    constructor(
        private plannerService: PlannerService,
    ) {}

    @Post(PlannerRoutes.RunMasterPlanRoute)
    runMasterPlan: RouteHandler<typeof PlannerRoutes.RunMasterPlanRoute> = async (c) => {
        const { projectId } = c.req.valid("json");
        try {
            // For a long running process like this, in a real app we'd probably use SSE or background jobs.
            // But for this MVP, we await the result.
            const result = await this.plannerService.runMasterPlan(
                projectId as types.project.ProjectId,
            );
            return c.json(result, 201);
        } catch (error) {
            const err = error as { message?: string };
            return c.json({ code: 400, message: err?.message || "Unknown error" }, 400);
        }
    };
}
