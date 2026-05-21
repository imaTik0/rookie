import { createRoute, z } from "@hono/zod-openapi";
import { ErrorSchema } from "../CommonSchema.ts";

export const PlannerRoutes = {
    RunMasterPlanRoute: createRoute({
        method: "post",
        path: "/planner/run",
        description: "Run the Master Planner for a specific project.",
        request: {
            body: {
                content: {
                    "application/json": {
                        schema: z.object({
                            projectId: z.string().describe("ID of the project to analyze"),
                            maxGoals: z.number().int().min(1).max(15).optional().default(5).describe("Maximum number of goals to generate"),
                            initialContext: z.string().optional().default("{}").describe("Initial context JSON for the executions"),
                        }),
                    },
                },
            },
        },
        responses: {
            200: {
                content: {
                    "application/x-ndjson": {
                        schema: z.string(),
                    },
                },
                description: "Master Plan NDJSON stream",
            },
            400: {
                description: "Bad Request",
                content: { "application/json": { schema: ErrorSchema } },
            },
        },
    }),
};
