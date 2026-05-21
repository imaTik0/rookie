import type { RouteHandler } from "@hono/zod-openapi";
import { Controller, Delete, Get } from "../Decorator.ts";
import { MasterPlanRoutes } from "./MasterPlanRoute.ts";
import { MasterPlanService } from "../../service/MasterPlanService.ts";
import * as types from "../../types/index.ts";

@Controller("/master-plans")
export class MasterPlanController {
    constructor(
        private masterPlanService: MasterPlanService,
    ) {}

    @Get(MasterPlanRoutes.ListMasterPlansRoute)
    listMasterPlans: RouteHandler<typeof MasterPlanRoutes.ListMasterPlansRoute> = async (c) => {
        const page = Number(c.req.query("page") || 1);
        const limit = Number(c.req.query("limit") || 10);
        const result = await this.masterPlanService.list(page, limit);
        return c.json(result, 200);
    };

    @Get(MasterPlanRoutes.GetMasterPlanRoute)
    getMasterPlan: RouteHandler<typeof MasterPlanRoutes.GetMasterPlanRoute> = async (c) => {
        const { masterPlanId } = c.req.valid("param");
        const plan = await this.masterPlanService.get(masterPlanId as types.planner.MasterPlanId);
        if (!plan) {
            return c.json({ code: 404, message: "Master Plan not found" }, 404);
        }
        return c.json(plan, 200);
    };

    @Delete(MasterPlanRoutes.DeleteMasterPlanRoute)
    deleteMasterPlan: RouteHandler<typeof MasterPlanRoutes.DeleteMasterPlanRoute> = async (c) => {
        const { masterPlanId } = c.req.valid("param");
        const deleted = await this.masterPlanService.delete(masterPlanId as types.planner.MasterPlanId);
        if (!deleted) {
            return c.json({ code: 404, message: "Master Plan not found" }, 404);
        }
        return c.body(null, 204);
    };
}
