/**
 * Orchestration tests for Executor.executeTestSuite (CODE_GENERATION path),
 * with the DockerExecutor, PromptService and repositories faked. No infra.
 * Run with: deno test src/service/Executor.orchestration.test.ts
 */
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
        },
    },
} as unknown as ConfigService;

const testSuite = {
    _id: "ts-1",
    mode: "CODE_GENERATION",
    projectId: "proj-1",
    initialContext: "{}",
    userGoal: "list the users",
    minimalStoryLength: 1,
    maximalStoryLength: 3,
};

function build(opts: {
    examples: { title: string; explanation: string; fullProgram: string }[];
    docker: ReturnType<typeof fakeDockerExecutor>;
}) {
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
        null as never, // fileService — unused (no project files)
        fakeLogger(),
        null as never, // vectorCollectionFactory — unused (env-error path)
        null as never, // embeddingService — unused
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
    assertEquals(docker.calls.length, 0); // nothing to run
    assertEquals(created.length, 1);
});

Deno.test("a failing step is classified and the report is FAILED", async () => {
    // Container exits non-zero with a missing-module error -> environment classification.
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
    // No project docs mention dayjs, so it's an environment (not docs) problem.
    assertEquals(report!.steps[0].failureAnalysis!.documentationGap, "ENVIRONMENT");
    assert(docker.calls.length === 1);
});
