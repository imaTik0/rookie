import { z } from "@hono/zod-openapi";

export const TestSuiteMode = z.enum(["TEST_SCENARIO", "CODE_GENERATION"])
    .describe("The mode of the test suite.")
    .openapi({ example: "TEST_SCENARIO" });

const TestSuiteId = z.string()
    .describe("Unique ID of the test suite.")
    .openapi({ example: "ts-8f3b2e" });

const ProjectId = z.string()
    .describe("The ID of the project this test suite belongs to.")
    .openapi({ example: "proj-a4c1d" });

const InitialContext = z.string()
    .describe("The initial JSON context (as a string) for the test suite's execution.")
    .openapi({ example: '{"user_id": 123, "session_id": "xyz"}' });

const FunctionTemplate = z.string()
    .describe("The template for the function/code being tested.")
    .openapi({ example: "function generate_story(context, length) { /* ... */ }" });

const MinimalLength = z.number().int().positive()
    .describe("The minimum length of the generated story/scenario.")
    .openapi({ example: 10 });

const MaximalLength = z.number().int().positive()
    .describe("The maximum length of the generated story/scenario.")
    .openapi({ example: 20 });

const UserGoal = z.string()
    .describe("The goal for code generation mode.")
    .openapi({ example: "Create a program that calculates the Fibonacci sequence." });

export const CreateTestSuiteSchema = z.object({
    initialContext: InitialContext,
    functionTemplate: FunctionTemplate.optional(),
    minimalStoryLength: MinimalLength,
    maximalStoryLength: MaximalLength,
    projectId: ProjectId,
    mode: TestSuiteMode.default("TEST_SCENARIO"),
    userGoal: UserGoal.optional(),
});

export const UpdateTestSuiteSchema = CreateTestSuiteSchema.partial();

export const TestSuiteSchema = CreateTestSuiteSchema.extend({
    id: TestSuiteId,
    createdAt: z.string().datetime()
        .describe("Timestamp of creation.")
        .openapi({ example: "2025-10-27T10:00:00Z" }),
    updatedAt: z.string().datetime()
        .describe("Timestamp of last update.")
        .openapi({ example: "2025-10-27T10:30:00Z" }),
});

export const TestSuiteIdParam = z.object({
    testSuiteId: TestSuiteId.describe("The unique ID of the Test Suite for URL path."),
});

export type TestSuiteMode = z.infer<typeof TestSuiteMode>;
export type TestSuite = z.infer<typeof TestSuiteSchema>;
export type CreateTestSuiteDTO = z.infer<typeof CreateTestSuiteSchema>;
export type UpdateTestSuiteDTO = z.infer<typeof UpdateTestSuiteSchema>;
export type TestSuiteIdParam = z.infer<typeof TestSuiteIdParam>;
