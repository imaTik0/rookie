import { assert, assertEquals } from "@std/assert";
import { Executor } from "./Executor.ts";
import type { ConfigService } from "./ConfigService.ts";
import type { PromptService } from "./PromptService.ts";
import type { TestSuiteRepository } from "../db/mongo/TestSuiteRepository.ts";
import type { ProjectRepository } from "../db/mongo/ProjectRepository.ts";
import type { ReportRepository } from "../db/mongo/ReportRepository.ts";
import { fakeDockerExecutor, fakeLogger } from "../testing/fakes.ts";

const cfg = {
    values: {
        sandbox: {
            networkMode: "none",
            stepTimeoutMs: 1000,
            hardening: true,
            user: "",
            pidsLimit: 256,
            networkName: "rookie-network",
            autoInstallDeps: false,
            requireGroundedSuccess: true,
        },
    },
} as unknown as ConfigService;

function build(opts: {
    examples: { title: string; explanation: string; fullProgram: string }[];
    docker: ReturnType<typeof fakeDockerExecutor>;
    initialContext?: string;
}) {
    const testSuite = {
        _id: "ts-1",
        mode: "CODE_GENERATION",
        projectId: "proj-1",
        initialContext: opts.initialContext ?? "{}",
        userGoal: "list the users",
        minimalStoryLength: 1,
        maximalStoryLength: 3,
    };
    const created: Record<string, unknown>[] = [];
    const promptService = {
        promptForCodeGenerationWithAgenticRAG: () =>
            Promise.resolve({
                response: { examples: opts.examples, finalMarkdownSummary: "summary" },
                history: [],
                contextFound: undefined,
                coverageReport: undefined,
                frictionEvents: [],
            }),
    } as unknown as PromptService;

    const ex = new Executor(
        { get: () => Promise.resolve(testSuite) } as unknown as TestSuiteRepository,
        promptService,
        { get: () => Promise.resolve({ files: [] }) } as unknown as ProjectRepository,
        null as never,
        fakeLogger(),
        null as never,
        null as never,
        {
            create: (data: Record<string, unknown>) => {
                created.push(data);
                return Promise.resolve({ ...data, _id: "rep-1" });
            },
        } as unknown as ReportRepository,
        cfg,
    );
    // deno-lint-ignore no-explicit-any
    (ex as any).dockerExecutor = opts.docker;
    return { ex, created };
}

Deno.test("executeTestSuite with no generated examples produces a SUCCESS report", async () => {
    const docker = fakeDockerExecutor([]);
    const { ex, created } = build({ examples: [], docker });
    // deno-lint-ignore no-explicit-any
    const report = await ex.executeTestSuite("ts-1" as any);
    assertEquals(report!.status, "SUCCESS");
    assertEquals(report!.steps.length, 0);
    assertEquals(docker.calls.length, 0);
    assertEquals(created.length, 1);
});

Deno.test("a failing step is classified and the report is FAILED", async () => {
    const docker = fakeDockerExecutor([
        { exitCode: 1, stdout: "", stderr: "Error: Cannot find module 'dayjs'" },
    ]);
    const { ex } = build({
        examples: [{
            title: "Use dayjs",
            explanation: "format a date",
            fullProgram: "import 'dayjs'",
        }],
        docker,
    });
    // deno-lint-ignore no-explicit-any
    const report = await ex.executeTestSuite("ts-1" as any);
    assertEquals(report!.status, "FAILED");
    assertEquals(report!.steps.length, 1);
    assertEquals(report!.steps[0].status, "FAILED");
    assertEquals(report!.steps[0].failureAnalysis!.documentationGap, "ENVIRONMENT");
    assert(docker.calls.length === 1);
});

const API_CTX = JSON.stringify({ apiBase: "http://host.docker.internal:14000/api/v1", token: "t" });

Deno.test("an exit-0 run with NO real API call is rejected as ROOKIE_UNGROUNDED_SUCCESS", async () => {
    const docker = fakeDockerExecutor([{
        exitCode: 0,
        stdout: `___RESULT_START___\n{"result":"ok","ctx":{}}\n___RESULT_END___`,
        stderr: "",
    }]);
    const { ex } = build({
        examples: [{
            title: "Mocked",
            explanation: "mocks the API",
            fullProgram: "export default async () => ({})",
        }],
        docker,
        initialContext: API_CTX,
    });
    // deno-lint-ignore no-explicit-any
    const report = await ex.executeTestSuite("ts-1" as any);
    assertEquals(report!.status, "FAILED");
    assert(String(report!.steps[0].error).includes("ROOKIE_UNGROUNDED_SUCCESS"));
    assertEquals(report!.steps[0].failureAnalysis!.documentationGap, "ENVIRONMENT");
});

Deno.test("an exit-0 run WITH a real call to the declared host passes", async () => {
    const traffic = JSON.stringify([{
        method: "GET",
        url: "http://host.docker.internal:14000/api/v1/users",
        responseStatus: 200,
    }]);
    const docker = fakeDockerExecutor([{
        exitCode: 0,
        stdout: `___RESULT_START___\n{"result":"ok","ctx":{}}\n___RESULT_END___\n` +
            `___HTTP_LOG_START___\n${traffic}\n___HTTP_LOG_END___`,
        stderr: "",
    }]);
    const { ex } = build({
        examples: [{
            title: "Real",
            explanation: "calls the API",
            fullProgram: "export default async () => ({})",
        }],
        docker,
        initialContext: API_CTX,
    });
    // deno-lint-ignore no-explicit-any
    const report = await ex.executeTestSuite("ts-1" as any);
    assertEquals(report!.status, "SUCCESS");
});

Deno.test("library-style contexts (no URLs) are exempt from grounding", async () => {
    const docker = fakeDockerExecutor([{
        exitCode: 0,
        stdout: `___RESULT_START___\n{"result":42,"ctx":{}}\n___RESULT_END___`,
        stderr: "",
    }]);
    const { ex } = build({
        examples: [{
            title: "Lib",
            explanation: "pure library use",
            fullProgram: "export default async () => 42",
        }],
        docker,
        initialContext: "{}",
    });
    // deno-lint-ignore no-explicit-any
    const report = await ex.executeTestSuite("ts-1" as any);
    assertEquals(report!.status, "SUCCESS");
});
