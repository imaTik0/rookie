import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { executionEnvironmentBlock } from "./templates.ts";

Deno.test("executionEnvironmentBlock is empty for an empty context", () => {
    assertEquals(executionEnvironmentBlock("{}"), "");
    assertEquals(executionEnvironmentBlock(undefined), "");
});

Deno.test("executionEnvironmentBlock is empty for invalid JSON", () => {
    assertEquals(executionEnvironmentBlock("not-json"), "");
});

Deno.test("executionEnvironmentBlock shows apiBase and mandates ctx-based URLs", () => {
    const block = executionEnvironmentBlock(
        JSON.stringify({ apiBase: "http://host.docker.internal:14106" }),
    );
    assertStringIncludes(block, "EXECUTION ENVIRONMENT (CRITICAL");
    assertStringIncludes(block, "http://host.docker.internal:14106");
    assertStringIncludes(block, "${ctx.apiBase}");
    assertStringIncludes(block, "localhost");
});

Deno.test("executionEnvironmentBlock masks secret-looking values", () => {
    const block = executionEnvironmentBlock(JSON.stringify({
        apiBase: "http://host.docker.internal:14000",
        token: "super-secret-value",
        apiKey: "k-123",
        password: "hunter2",
    }));
    assert(!block.includes("super-secret-value"));
    assert(!block.includes("k-123"));
    assert(!block.includes("hunter2"));
    assertStringIncludes(block, '"token"');
    assertStringIncludes(block, '"apiKey"');
    assertStringIncludes(block, "reference it via ctx");
});
