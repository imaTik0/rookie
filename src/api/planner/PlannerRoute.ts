import { createRoute, z } from "@hono/zod-openapi";
import { ErrorSchema } from "../CommonSchema.ts";

export const PlannerRoutes = {
    RunMasterPlanRoute: createRoute({
        method: "post",
        path: "/planner/run",
        tags: ["Planner"],
        summary: "Run the Master Planner over a project (streaming)",
        description:
            `Runs the end-to-end evaluation for a project and **streams progress as NDJSON** \
(one JSON object per line; \`Content-Type: application/x-ndjson\`).

The planner: (1) reads the project's documentation and generates up to \`maxGoals\` realistic \
developer goals; (2) for each goal, runs the Agentic RAG loop (Research → Verification → \
Generation) and executes the generated code in an isolated Docker sandbox, classifying any \
failure; (3) synthesises a structured master summary (pass rate, failure taxonomy, per-goal \
breakdown, documentation gaps, recommendations) and persists it as a \`MASTER_PLAN\` report.

**Stream event shape** — each line is \`{ "type": ..., ... }\`. Notable types: \`INIT\`, \
\`GOALS_GENERATED\` (the goal list), \`GOAL_START\` / \`GOAL_PROGRESS\` / \`GOAL_COMPLETE\` (per \
goal), \`SUMMARY_GENERATED\`, and a terminal \`COMPLETE\` carrying the saved master-plan report \
(or \`ERROR\` with a message). \`initialContext\` is a JSON **string** injected into each \
execution (e.g. auth tokens / base URL): \`'{"apiBase":"http://host.docker.internal:14000/api/v1","token":"..."}'\`.

This is long-running — duration scales with \`maxGoals\` and model/sandbox latency.`,
        request: {
            body: {
                content: {
                    "application/json": {
                        schema: z.object({
                            projectId: z.string().describe("ID of the project to analyse").openapi({
                                example: "proj_clx123abc0000m8ols1234567",
                            }),
                            maxGoals: z.number().int().min(1).max(15).optional().default(5).describe(
                                "Maximum number of developer goals to generate and execute (1–15)",
                            ),
                            initialContext: z.string().optional().default("{}").describe(
                                "JSON string injected as the initial execution context for every goal " +
                                    "(e.g. base URL and auth token)",
                            ).openapi({
                                example: '{"apiBase":"http://host.docker.internal:14000/api/v1","token":"<token>"}',
                            }),
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
                description:
                    "NDJSON progress stream; the terminal `COMPLETE` line carries the persisted master-plan report.",
            },
            400: {
                description: "Invalid request, or the project has no indexed documentation to plan over.",
                content: { "application/json": { schema: ErrorSchema } },
            },
        },
    }),
};
