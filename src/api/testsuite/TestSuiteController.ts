import type { RouteHandler } from "@hono/zod-openapi";
import { Controller, Delete, Get, Post, Put } from "../Decorator.ts";
import { TestSuiteRoutes } from "./TestSuiteRoute.ts";
import { Executor } from "../../service/Executor.ts";
import { TestSuiteService } from "../../service/TestService.ts";
import * as types from "../../types/index.ts";

@Controller("/testsuites")
export class TestSuiteController {
    constructor(
        private testSuiteService: TestSuiteService,
        private executor: Executor,
    ) {}

    @Post(TestSuiteRoutes.CreateTestSuiteRoute)
    createTestSuite: RouteHandler<typeof TestSuiteRoutes.CreateTestSuiteRoute> = async (c) => {
        const {
            projectId,
            initialContext,
            functionTemplate,
            minimalStoryLength,
            maximalStoryLength,
        } = c.req.valid("json");
        const newTestSuite = await this.testSuiteService.createTestSuite(
            projectId as types.project.ProjectId,
            initialContext,
            functionTemplate,
            minimalStoryLength,
            maximalStoryLength,
        );
        return c.json(newTestSuite, 201);
    };

    @Get(TestSuiteRoutes.ListTestSuitesRoute)
    listTestSuites: RouteHandler<typeof TestSuiteRoutes.ListTestSuitesRoute> = async (c) => {
        const { page, limit } = c.req.valid("query");
        const result = await this.testSuiteService.listTestSuites({ page, limit });
        return c.json(result, 200);
    };

    @Get(TestSuiteRoutes.GetTestSuiteRoute)
    getTestSuite: RouteHandler<typeof TestSuiteRoutes.GetTestSuiteRoute> = async (c) => {
        const { testSuiteId } = c.req.valid("param");
        const testSuite = await this.testSuiteService.getTestSuite(
            testSuiteId as types.test.TestSuiteId,
        );
        if (!testSuite) {
            return c.json({ code: 404, message: "Project not found" }, 404);
        }
        return c.json(testSuite, 200);
    };

    @Put(TestSuiteRoutes.UpdateTestSuiteRoute)
    updateTestSuite: RouteHandler<typeof TestSuiteRoutes.UpdateTestSuiteRoute> = async (c) => {
        const { testSuiteId } = c.req.valid("param");
        const updateDto = c.req.valid("json");
        const updatedSuite = await this.testSuiteService.updateTestSuite(
            testSuiteId as types.test.TestSuiteId,
            updateDto,
        );
        if (!updatedSuite) {
            return c.json({ code: 404, message: "Project not found" }, 404);
        }
        return c.json(updatedSuite, 200);
    };

    @Delete(TestSuiteRoutes.DeleteTestSuiteRoute)
    deleteTestSuite: RouteHandler<typeof TestSuiteRoutes.DeleteTestSuiteRoute> = async (c) => {
        const { testSuiteId } = c.req.valid("param");
        const deleted = await this.testSuiteService.deleteTestSuite(
            testSuiteId as types.test.TestSuiteId,
        );
        if (!deleted) {
            return c.text("Not Found", 404);
        }
        return c.body(null, 204);
    };

    @Post(TestSuiteRoutes.ExecuteTestSuiteRoute)
    executeTestSuite: RouteHandler<typeof TestSuiteRoutes.ExecuteTestSuiteRoute> = async (c) => {
        const { testSuiteId } = c.req.valid("param");
        const executionResult = await this.executor.executeTestSuite(
            testSuiteId as types.test.TestSuiteId,
        );
        return c.json(executionResult as any, 202); // TO FILL
    };
}
