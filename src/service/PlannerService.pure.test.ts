/**
 * Characterization tests for PlannerService's pure logic: gap regression
 * matching and endpoint-inventory extraction. Reaches private methods via
 * `as any` to pin behaviour before any extraction. No infra.
 * Run with: deno test src/service/PlannerService.pure.test.ts
 */
import { assert, assertEquals } from "@std/assert";
import { PlannerService } from "./PlannerService.ts";
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

// ── gapsSimilar ──────────────────────────────────────────────────────────────────

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
    // overlap uses > 0, so ranges sharing a single endpoint are different gaps.
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

// ── extractEndpointInventory ──────────────────────────────────────────────────────

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
