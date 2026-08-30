import { createRoute, z } from "@hono/zod-openapi";
import { ErrorSchema } from "../CommonSchema.ts";

export const PlannerRoutes = {
    RerunMasterPlanRoute: createRoute({
        method: "post",
        path: "/planner/rerun",
        tags: ["Planner"],
        summary: "Re-run an existing master plan (streaming)",
        description: `Re-runs a previously saved MASTER_PLAN report, **skipping goal generation** \
and reusing the goals that were produced in the original run. Progress is **streamed as NDJSON** \
identical to \`/planner/run\`.

Typical use-case: run the original plan on documentation v1, fix the identified gaps, upload \
the fixed docs as a new project, then call this endpoint with \`masterPlanId\` pointing to the \
v1 run and \`projectId\` pointing to the v2 project. Because the goals are reused you get a \
directly comparable before/after result — gap regression status will show which issues were \
resolved.

If \`projectId\` is omitted the original project is re-used (useful for retrying a run or \
measuring natural variance across executions).`,
        request: {
            body: {
                content: {
                    "application/json": {
                        schema: z.object({
                            masterPlanId: z.string().describe(
                                "ID of the MASTER_PLAN report whose goals should be re-run.",
                            ).openapi({ example: "rep_abc123" }),
                            projectId: z.string().optional().describe(
                                "Override the project to run against (e.g. a project with updated docs). " +
                                    "Defaults to the original plan's project.",
                            ),
                            initialContext: z.string().optional().describe(
                                "JSON string injected as execution context. Defaults to the original plan's context.",
                            ).openapi({
                                example:
                                    '{"apiBase":"http://host.docker.internal:14000/api/v1","token":"<token>"}',
                            }),
                            goalIndices: z.array(z.number().int().min(0)).optional().describe(
                                "0-based indices into the original plan's saved goals; only the " +
                                    "selected goals are re-run. Omit to re-run all goals. Used by " +
                                    "harnesses that exercise a single documentation fragment (e.g. " +
                                    "mutation testing) to avoid paying for unrelated goals.",
                            ).openapi({ example: [0, 2] }),
                            skipDocExamples: z.boolean().optional().describe(
                                "Skip the doc-example smoke phase (up to 10 sandbox executions). " +
                                    "Useful when the caller only consumes goal-level results.",
                            ),
                            packageOverrides: z.record(z.string(), z.string()).optional().describe(
                                'npm install pins (name → version|"latest") applied on top of the ' +
                                    "packages parsed from generated code. The library drift experiment " +
                                    "pins `<pkg>@<newVersion>` here for the experiment phase.",
                            ).openapi({ example: { execa: "10.0.0" } }),
                            freeze: z.boolean().optional().describe(
                                "Re-execute the ORIGINAL run's generated programs VERBATIM instead of " +
                                    "regenerating code. Drift is then measured on identical code and the " +
                                    "agent cannot route around the change (recommended for the experiment phase).",
                            ),
                            withoutDocs: z.boolean().optional().describe(
                                "Docs-ablation arm: regenerate WITHOUT documentation (no RAG), so the " +
                                    "agent relies on parametric knowledge. `pass_with − pass_without` " +
                                    "measures the documentation's value.",
                            ),
                            expectedApis: z.array(z.string()).optional().describe(
                                "Documented API symbols the goals should exercise; code using none of " +
                                    "them is flagged as a docs-faithfulness dodge.",
                            ),
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
                    "NDJSON progress stream; terminal `COMPLETE` carries the new master-plan report.",
            },
            400: {
                description: "Invalid request or the referenced master plan was not found.",
                content: { "application/json": { schema: ErrorSchema } },
            },
        },
    }),

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
                            maxGoals: z.number().int().min(1).max(15).optional().default(5)
                                .describe(
                                    "Maximum number of developer goals to generate and execute (1–15)",
                                ),
                            initialContext: z.string().optional().default("{}").describe(
                                "JSON string injected as the initial execution context for every goal " +
                                    "(e.g. base URL and auth token)",
                            ).openapi({
                                example:
                                    '{"apiBase":"http://host.docker.internal:14000/api/v1","token":"<token>"}',
                            }),
                            packageOverrides: z.record(z.string(), z.string()).optional().describe(
                                'npm install pins (name → version|"latest") applied on top of the ' +
                                    "packages parsed from generated code. The library drift experiment " +
                                    "pins `<pkg>@<oldVersion>` here for the baseline phase.",
                            ).openapi({ example: { sequelize: "5.22.5" } }),
                            changelogSeed: z.string().optional().describe(
                                "Changelog-drift steering block injected ONLY into goal generation, " +
                                    "so goals target documented breaking-change areas (valid on the old " +
                                    "version, broken on the new). Not passed to the code-writing phase.",
                            ),
                            withoutDocs: z.boolean().optional().describe(
                                "Docs-ablation arm: generate code WITHOUT documentation (no RAG), so " +
                                    "the agent relies on parametric knowledge only.",
                            ),
                            expectedApis: z.array(z.string()).optional().describe(
                                "Documented API symbols the goals should exercise; code using none of " +
                                    "them is flagged as a docs-faithfulness dodge.",
                            ),
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
                description:
                    "Invalid request, or the project has no indexed documentation to plan over.",
                content: { "application/json": { schema: ErrorSchema } },
            },
        },
    }),
};
