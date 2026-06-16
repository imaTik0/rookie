import type { RouteHandler } from "@hono/zod-openapi";
import { Controller, Get } from "../Decorator.ts";
import { TraceRepository } from "../../db/mongo/TraceRepository.ts";
import { TraceRoutes } from "./TraceRoute.ts";
import * as types from "../../types/index.ts";

@Controller()
export class TraceController {
    constructor(private traceRepository: TraceRepository) {}

    @Get(TraceRoutes.GetTracesByTestSuiteRoute)
    getTracesByTestSuite: RouteHandler<typeof TraceRoutes.GetTracesByTestSuiteRoute> = async (
        c,
    ) => {
        const { testSuiteId } = c.req.valid("param");
        const traces = await this.traceRepository.getByTestSuiteId(testSuiteId);
        return c.json(traces, 200);
    };

    @Get(TraceRoutes.GetTraceByIdRoute)
    getTraceById: RouteHandler<typeof TraceRoutes.GetTraceByIdRoute> = async (c) => {
        const { traceId } = c.req.valid("param");
        const trace = await this.traceRepository.getById(traceId as types.trace.TraceId);
        if (!trace) {
            return c.json({ code: 404, message: "Trace not found" }, 404);
        }
        return c.json(trace, 200);
    };
}
