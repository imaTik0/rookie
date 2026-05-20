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
                        }),
                    },
                },
            },
        },
        responses: {
            201: {
                content: {
                    "application/json": {
                        schema: z.object({
                            _id: z.string(),
                            projectId: z.string(),
                            goals: z.array(z.string()),
                            reports: z.array(z.string()),
                            finalSummary: z.string(),
                            createdAt: z.string(),
                        }),
                    },
                },
                description: "Master Plan report created",
            },
            400: {
                description: "Bad Request",
                content: { "application/json": { schema: ErrorSchema } },
            },
        },
    }),
};
