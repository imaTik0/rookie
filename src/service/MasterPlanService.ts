import { MasterPlanRepository } from "./MasterPlanRepository.ts";
import * as types from "../types/index.ts";
import * as db from "../db/mongo/Model.ts";

export class MasterPlanService {
    constructor(
        private masterPlanRepository: MasterPlanRepository,
    ) {}

    private toListItem(plan: db.MasterPlanReport) {
        // Count passed/failed from structuredSummary if available
        const goals = plan.structuredSummary?.goalsBreakdown ?? plan.goals.map((g: string) => ({ goal: g, status: "UNKNOWN" }));
        const passedCount = goals.filter((g: { status: string }) => g.status === "SUCCESS").length;
        const failedCount = goals.filter((g: { status: string }) => g.status !== "SUCCESS").length;
        
        return {
            id: plan._id,
            projectId: plan.projectId,
            goals: plan.goals,
            passedCount,
            failedCount,
            createdAt: plan.createdAt.toISOString(),
        };
    }

    private toDetail(plan: db.MasterPlanReport) {
        return {
            id: plan._id,
            projectId: plan.projectId,
            goals: plan.goals,
            reports: plan.reports,
            finalSummary: plan.finalSummary,
            structuredSummary: plan.structuredSummary,
            createdAt: plan.createdAt.toISOString(),
        };
    }

    async list(page: number, limit: number) {
        const { reports: plans, total } = await this.masterPlanRepository.list({ page, limit });
        return {
            masterPlans: plans.map((p: db.MasterPlanReport) => this.toListItem(p)),
            total,
        };
    }

    async get(masterPlanId: types.planner.MasterPlanId) {
        const plan = await this.masterPlanRepository.get(masterPlanId);
        if (!plan) return null;
        return this.toDetail(plan);
    }

    async delete(masterPlanId: types.planner.MasterPlanId): Promise<boolean> {
        return await this.masterPlanRepository.delete(masterPlanId);
    }
}
