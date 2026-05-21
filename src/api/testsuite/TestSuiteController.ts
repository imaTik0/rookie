import { streamSSE } from "hono/streaming";
import type { RouteHandler } from "@hono/zod-openapi";
import { Controller, Delete, Get, Post, Put } from "../Decorator.ts";
import { TestSuiteRoutes } from "./TestSuiteRoute.ts";
import { Executor } from "../../service/Executor.ts";
import { TestSuiteService } from "../../service/TestService.ts";
import { ReportService } from "../../service/ReportService.ts";
import * as types from "../../types/index.ts";

@Controller("/testsuites")
export class TestSuiteController {
    constructor(
        private testSuiteService: TestSuiteService,
        private executor: Executor,
        private reportService: ReportService,
    ) {}

    @Post(TestSuiteRoutes.CreateTestSuiteRoute)
    createTestSuite: RouteHandler<typeof TestSuiteRoutes.CreateTestSuiteRoute> = async (c) => {
        const data = c.req.valid("json");
        const newTestSuite = await this.testSuiteService.createTestSuite(data);
        return c.json(newTestSuite as unknown as object, 201);
    };

    @Get(TestSuiteRoutes.ListTestSuitesRoute)
    listTestSuites: RouteHandler<typeof TestSuiteRoutes.ListTestSuitesRoute> = async (c) => {
        const { page, limit } = c.req.valid("query");
        const result = await this.testSuiteService.listTestSuites({ page, limit });
        return c.json(result as unknown as object, 200);
    };

    @Get(TestSuiteRoutes.GetTestSuiteRoute)
    getTestSuite: RouteHandler<typeof TestSuiteRoutes.GetTestSuiteRoute> = async (c) => {
        const { testSuiteId } = c.req.valid("param");
        const testSuite = await this.testSuiteService.getTestSuite(
            testSuiteId as types.test.TestSuiteId,
        );
        if (!testSuite) {
            return c.json({ code: 404, message: "TestSuite not found" }, 404);
        }
        return c.json(testSuite as unknown as object, 200);
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
            return c.json({ code: 404, message: "TestSuite not found" }, 404);
        }
        return c.json(updatedSuite as unknown as object, 200);
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
        if (!executionResult) {
            return c.json({ code: 404, message: "TestSuite or Project not found" }, 404);
        }
        const apiReport = this.reportService.mapReportToApi(executionResult);
        return c.json(apiReport as unknown as object, 202);
    };

    @Get(TestSuiteRoutes.StreamExecuteTestSuiteRoute)
    streamExecuteTestSuite: RouteHandler<typeof TestSuiteRoutes.StreamExecuteTestSuiteRoute> =
        async (c) => {
            const { testSuiteId } = c.req.valid("param");

            return streamSSE(c, async (stream) => {
                const onProgress = async (message: string) => {
                    await stream.writeSSE({ data: message });
                };

                try {
                    const executionResult = await this.executor.executeTestSuite(
                        testSuiteId as types.test.TestSuiteId,
                        onProgress,
                    );

                    if (!executionResult) {
                        await stream.writeSSE({
                            event: "error",
                            data: "TestSuite or Project not found",
                        });
                    } else {
                        const apiReport = this.reportService.mapReportToApi(executionResult);
                        await stream.writeSSE({ event: "done", data: JSON.stringify(apiReport) });
                    }
                } catch (error) {
                    const err = error as Error;
                    await stream.writeSSE({ event: "error", data: err.message || "Unknown error" });
                }
            });
        };
}
