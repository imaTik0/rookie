import { createRoute, z } from "@hono/zod-openapi";
import { ErrorSchema } from "../CommonSchema.ts";

const GoalBreakdownSchema = z.object({
    goal: z.string(),
    status: z.string(),
    reportId: z.string().nullable(),
    keyFindings: z.string(),
});

const DocumentationGapDetailSchema = z.object({
    fragment: z.string(),
    proposedFix: z.string(),
    affectedGoals: z.array(z.string()),
    file: z.string().nullable().optional(),
});

const TopFailingFunctionSchema = z.object({
    functionName: z.string(),
    count: z.number(),
    goals: z.array(z.string()),
});

const StructuredSummarySchema = z.object({
    executiveSummary: z.string(),
    overallPassRate: z.number(),
    failureTaxonomy: z.record(z.string(), z.number()),
    topFailingFunctions: z.array(TopFailingFunctionSchema),
    goalsBreakdown: z.array(GoalBreakdownSchema),
    documentationGapDetails: z.array(DocumentationGapDetailSchema),
    recommendations: z.array(z.string()),
});

const MasterPlanListItemSchema = z.object({
    id: z.string(),
    projectId: z.string(),
    goals: z.array(z.string()),
    passedCount: z.number(),
    failedCount: z.number(),
    createdAt: z.string(),
});

const MasterPlanDetailSchema = z.object({
    id: z.string(),
    projectId: z.string(),
    goals: z.array(z.string()),
    reports: z.array(z.string()),
    finalSummary: z.string(),
    structuredSummary: StructuredSummarySchema.optional(),
    createdAt: z.string(),
});

export const MasterPlanRoutes = {
    ListMasterPlansRoute: createRoute({
        method: "get",
        path: "/master-plans",
        description: "List all Master Plan reports (paginated).",
        request: {
            query: z.object({
                page: z.string().optional().default("1"),
                limit: z.string().optional().default("10"),
            }),
        },
        responses: {
            200: {
                content: {
                    "application/json": {
                        schema: z.object({
                            masterPlans: z.array(MasterPlanListItemSchema),
                            total: z.number(),
                        }),
                    },
                },
                description: "List of Master Plan reports",
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorSchema } } },
        },
    }),

    GetMasterPlanRoute: createRoute({
        method: "get",
        path: "/master-plans/:masterPlanId",
        description: "Get a single Master Plan report with full details.",
        request: {
            params: z.object({ masterPlanId: z.string() }),
        },
        responses: {
            200: {
                content: { "application/json": { schema: MasterPlanDetailSchema } },
                description: "Full Master Plan report",
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorSchema } } },
        },
    }),

    DeleteMasterPlanRoute: createRoute({
        method: "delete",
        path: "/master-plans/:masterPlanId",
        description: "Delete a Master Plan report.",
        request: {
            params: z.object({ masterPlanId: z.string() }),
        },
        responses: {
            204: { description: "Deleted" },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorSchema } } },
        },
    }),
};
