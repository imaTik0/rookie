import { assert, assertEquals, assertThrows } from "@std/assert";
import { PlannerService, selectGoals } from "./PlannerService.ts";
import { fakeLogger } from "../testing/fakes.ts";

// deno-lint-ignore no-explicit-any
function planner(): any {
    return new PlannerService(
        null as never,
        null as never,
        null as never,
        null as never,
        null as never,
        null as never,
        null as never,
        fakeLogger(),
    );
}

function docFile(filename: string, content: string) {
    return { metadata: { filename }, buffer: new TextEncoder().encode(content) };
}

Deno.test("gapsSimilar: same file + overlapping line range -> persisted", () => {
    const cluster = {
        file: "a.md",
        lineStart: 5,
        lineEnd: 10,
        fragment: "x",
        documentationGap: "MISSING",
    };
    const prior = { file: "a.md", lineStart: 8, lineEnd: 12, fragment: "totally different prose" };
    assert(planner().gapsSimilar(cluster, prior));
});

Deno.test("gapsSimilar: high fragment token-overlap -> persisted", () => {
    const cluster = { fragment: "the auth token header is required", documentationGap: "MISSING" };
    const prior = { fragment: "the auth token header is required" };
    assert(planner().gapsSimilar(cluster, prior));
});

Deno.test("gapsSimilar: same failed function + category in prior fragment -> persisted", () => {
    const cluster = {
        failedFunction: "connect",
        documentationGap: "INCORRECT",
        fragment: "zzz unrelated",
    };
    const prior = { fragment: "you must call connect() before use", documentationGap: "INCORRECT" };
    assert(planner().gapsSimilar(cluster, prior));
});

Deno.test("gapsSimilar: unrelated gaps -> not persisted", () => {
    const cluster = {
        file: "a.md",
        lineStart: 1,
        lineEnd: 2,
        fragment: "alpha beta",
        failedFunction: "foo",
        documentationGap: "MISSING",
    };
    const prior = {
        file: "b.md",
        lineStart: 50,
        lineEnd: 60,
        fragment: "gamma delta",
        documentationGap: "CONFIG",
    };
    assertEquals(planner().gapsSimilar(cluster, prior), false);
});

Deno.test("gapsSimilar: adjacent (touching) line ranges are NOT overlap", () => {
    const cluster = {
        file: "a.md",
        lineStart: 1,
        lineEnd: 5,
        fragment: "x",
        documentationGap: "MISSING",
    };
    const prior = { file: "a.md", lineStart: 5, lineEnd: 9, fragment: "totally different" };
    assertEquals(planner().gapsSimilar(cluster, prior), false);
});

Deno.test("extractEndpointInventory lists OpenAPI path+method entries", () => {
    const spec = JSON.stringify({
        openapi: "3.0.0",
        paths: { "/users": { get: { summary: "List users" }, post: { summary: "Create" } } },
    });
    const inv = planner().extractEndpointInventory([docFile("spec.json", spec)]) as string;
    assert(inv.includes("GET /users"));
    assert(inv.includes("POST /users"));
    assert(inv.includes("List users"));
});

Deno.test("extractEndpointInventory picks up HTTP-verb markdown headings", () => {
    const md = "## GET /things\nReturns things.\n### POST /things/{id}\nCreates.";
    const inv = planner().extractEndpointInventory([docFile("api.md", md)]) as string;
    assert(inv.includes("GET /things"));
});

Deno.test("extractEndpointInventory returns undefined when no endpoints found", () => {
    const inv = planner().extractEndpointInventory([
        docFile("notes.md", "Just some prose with no endpoints."),
    ]);
    assertEquals(inv, undefined);
});

Deno.test("executeGoals: a throwing goal is recorded FAILED, others still complete", async () => {
    const testSuiteRepo = {
        create: () => Promise.resolve({ _id: "ts-" + crypto.randomUUID() }),
        delete: () => Promise.resolve(),
    };
    let call = 0;
    const executor = {
        executeTestSuite: () => {
            call++;
            if (call === 2) {
                return Promise.reject(
                    new Error("Structured output failed validation after repairs"),
                );
            }
            return Promise.resolve({ _id: "rep-" + call, status: "SUCCESS", steps: [] });
        },
    };
    const config = { values: { planner: { parallelGoals: 1 } } };
    // deno-lint-ignore no-explicit-any
    const ps = new PlannerService(
        null as never,
        null as never,
        null as never,
        executor as any,
        testSuiteRepo as any,
        null as never,
        config as any,
        fakeLogger(),
    ) as any;

    const { reportIds, executionReports } = await ps.executeGoals(
        ["good goal", "bad goal"],
        "proj-1",
        "{}",
    );

    assertEquals(executionReports.length, 2);
    assertEquals(executionReports[0].status, "SUCCESS");
    assertEquals(executionReports[1].status, "FAILED");
    assertEquals(reportIds.length, 1);
});

Deno.test("selectGoals returns all goals when no subset is given", () => {
    assertEquals(selectGoals(["a", "b", "c"]), ["a", "b", "c"]);
});

Deno.test("selectGoals picks the subset in saved order, deduped", () => {
    assertEquals(selectGoals(["a", "b", "c"], [2, 0, 2]), ["a", "c"]);
});

Deno.test("selectGoals drops out-of-range indices but keeps valid ones", () => {
    assertEquals(selectGoals(["a", "b"], [1, 5, -1]), ["b"]);
});

Deno.test("selectGoals throws when the subset selects nothing", () => {
    assertThrows(() => selectGoals(["a", "b"], [7]), Error, "selects none");
});
