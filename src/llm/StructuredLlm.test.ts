/**
 * Unit tests for structured-output handling: JSON extraction, zod validation,
 * the repair loop, and json_schema -> json_object runtime degrade.
 * Run with: deno test src/llm/StructuredLlm.test.ts
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { z } from "zod";
import { chatStructured, coerceJson, extractJson } from "./StructuredLlm.ts";
import { apiError, fakeLogger, fakeOpenAI } from "../testing/fakes.ts";

// ── extractJson ────────────────────────────────────────────────────────────────

Deno.test("extractJson unwraps ```json fences", () => {
    assertEquals(extractJson('```json\n{"a":1}\n```'), '{"a":1}');
});

Deno.test("extractJson isolates an object embedded in prose", () => {
    assertEquals(extractJson('Sure! Here it is: {"a":1} — done.'), '{"a":1}');
});

Deno.test("extractJson handles array roots", () => {
    assertEquals(extractJson("noise [1,2,3] tail"), "[1,2,3]");
});

Deno.test("extractJson keeps nested braces (matches outer object)", () => {
    assertEquals(extractJson('x {"a":{"b":2}} y'), '{"a":{"b":2}}');
});

Deno.test("extractJson returns trimmed body when no JSON present", () => {
    assertEquals(extractJson("  no json here  "), "no json here");
});

// ── coerceJson ───────────────────────────────────────────────────────────────

const schema = z.object({ name: z.string() });

Deno.test("coerceJson parses + validates a good payload", () => {
    const r = coerceJson('{"name":"rookie"}', schema);
    assert(r.ok);
    if (r.ok) assertEquals(r.data.name, "rookie");
});

Deno.test("coerceJson reports invalid JSON", () => {
    const r = coerceJson("{not json", schema);
    assert(!r.ok);
    if (!r.ok) assert(r.error.includes("Invalid JSON"));
});

Deno.test("coerceJson reports zod validation failure", () => {
    const r = coerceJson('{"name":123}', schema);
    assert(!r.ok);
});

// ── chatStructured ─────────────────────────────────────────────────────────────

Deno.test("chatStructured returns typed data on first valid response", async () => {
    const { openai, calls } = fakeOpenAI([{ content: '{"name":"ok"}' }]);
    const out = await chatStructured({
        openai,
        model: "m",
        system: "s",
        user: "u",
        schema,
        mode: "json_object",
        logger: fakeLogger(),
    });
    assertEquals(out.name, "ok");
    assertEquals(calls.length, 1);
    assertEquals((calls[0].response_format as { type: string }).type, "json_object");
});

Deno.test("chatStructured repairs an invalid response, then succeeds", async () => {
    const { openai, calls } = fakeOpenAI([
        { content: '{"name":123}' }, // fails zod
        { content: '{"name":"fixed"}' }, // repair succeeds
    ]);
    const out = await chatStructured({
        openai,
        model: "m",
        system: "s",
        user: "u",
        schema,
        mode: "json_object",
        maxRepairAttempts: 1,
        logger: fakeLogger(),
    });
    assertEquals(out.name, "fixed");
    assertEquals(calls.length, 2);
});

Deno.test("chatStructured degrades json_schema -> json_object on a 400 schema rejection", async () => {
    let n = 0;
    const { openai, calls } = fakeOpenAI(() => {
        n++;
        if (n === 1) return { error: apiError(400, "response_format json_schema unsupported") };
        return { content: '{"name":"degraded"}' };
    });
    const out = await chatStructured({
        openai,
        model: "m",
        system: "s",
        user: "u",
        schema,
        mode: "json_schema",
        logger: fakeLogger(),
    });
    assertEquals(out.name, "degraded");
    assertEquals(calls.length, 2);
    // First attempt requested a strict schema; the retry dropped to loose JSON mode.
    assertEquals((calls[0].response_format as { type: string }).type, "json_schema");
    assertEquals((calls[1].response_format as { type: string }).type, "json_object");
});

Deno.test("chatStructured throws after exhausting repair attempts", async () => {
    const { openai } = fakeOpenAI([{ content: "still not valid" }]);
    await assertRejects(
        () =>
            chatStructured({
                openai,
                model: "m",
                system: "s",
                user: "u",
                schema,
                mode: "json_object",
                maxRepairAttempts: 1,
                logger: fakeLogger(),
            }),
        Error,
        "failed validation",
    );
});
