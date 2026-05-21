import type { RouteHandler } from "@hono/zod-openapi";
import { Controller, Post } from "../Decorator.ts";
import { PlannerService } from "../../service/PlannerService.ts";
import * as types from "../../types/index.ts";
import { PlannerRoutes } from "./PlannerRoute.ts";
import { streamText } from "hono/streaming";

@Controller("/planner")
export class PlannerController {
    constructor(
        private plannerService: PlannerService,
    ) {}

    @Post(PlannerRoutes.RunMasterPlanRoute)
    runMasterPlan: RouteHandler<typeof PlannerRoutes.RunMasterPlanRoute> = async (c) => {
        const { projectId, maxGoals } = c.req.valid("json");
        
        return streamText(c, async (stream) => {
            try {
                const result = await this.plannerService.runMasterPlan(
                    projectId as types.project.ProjectId,
                    maxGoals,
                    async (msg) => {
                        await stream.writeln(msg);
                    }
                );
                await stream.writeln(JSON.stringify({ type: "COMPLETE", result }));
            } catch (error) {
                const err = error as { message?: string };
                await stream.writeln(JSON.stringify({ type: "ERROR", message: err?.message || "Unknown error" }));
            }
        }) as any;
    };
}
