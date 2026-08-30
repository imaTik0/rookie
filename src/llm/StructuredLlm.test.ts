import { assert, assertEquals, assertRejects } from "@std/assert";
import { z } from "zod";
import { chatStructured, coerceJson, extractJson } from "./StructuredLlm.ts";
import { apiError, fakeLogger, fakeOpenAI } from "../testing/fakes.ts";

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

Deno.test("extractJson ignores a nested ```yaml block inside a string value (regression)", () => {
    const payload = {
        examples: [],
        finalMarkdownSummary:
            "Use:\n```yaml\nreadinessProbe:\n  httpGet:\n    path: /ready\n    port: 8086\n```",
    };
    const parsed = JSON.parse(extractJson(JSON.stringify(payload)));
    assertEquals(parsed.finalMarkdownSummary, payload.finalMarkdownSummary);
});

Deno.test("extractJson unwraps ```json even when a value contains a nested ```js block", () => {
    const payload = { title: "x", code: "```js\nconsole.log(1);\n```" };
    const raw = "```json\n" + JSON.stringify(payload) + "\n```";
    assertEquals(JSON.parse(extractJson(raw)).code, payload.code);
});

Deno.test("coerceJson recovers a payload with a nested ```yaml fence", () => {
    const s = z.object({ finalMarkdownSummary: z.string() });
    const raw = JSON.stringify({ finalMarkdownSummary: "```yaml\nkey: val\n```" });
    const r = coerceJson(raw, s);
    assert(r.ok);
});

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
        { content: '{"name":123}' },
        { content: '{"name":"fixed"}' },
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

Deno.test("an EMPTY completion is retried as transient, not 'repaired'", async () => {
    const { openai, calls } = fakeOpenAI([{ content: "" }, { content: '{"name":"ok"}' }]);
    const out = await chatStructured({
        openai,
        model: "m",
        system: "s",
        user: "u",
        schema,
        mode: "json_object",
        maxRetries: 2,
        retryBaseMs: 1,
        logger: fakeLogger(),
    });
    assertEquals(out.name, "ok");
    assertEquals(calls.length, 2);
    assertEquals((calls[1].messages as unknown[]).length, 2);
});

Deno.test("a whitespace-only completion is also treated as empty", async () => {
    const { openai, calls } = fakeOpenAI([{ content: "   \n  " }, { content: '{"name":"ok"}' }]);
    const out = await chatStructured({
        openai,
        model: "m",
        system: "s",
        user: "u",
        schema,
        mode: "json_object",
        maxRetries: 2,
        retryBaseMs: 1,
        logger: fakeLogger(),
    });
    assertEquals(out.name, "ok");
    assertEquals((calls[1].messages as unknown[]).length, 2);
});

Deno.test("persistent empty completions surface as an empty-completion error", async () => {
    const { openai } = fakeOpenAI([{ content: "" }]);
    await assertRejects(
        () =>
            chatStructured({
                openai,
                model: "m",
                system: "s",
                user: "u",
                schema,
                mode: "json_object",
                maxRetries: 1,
                retryBaseMs: 1,
                logger: fakeLogger(),
            }),
        Error,
        "empty completion",
    );
});

Deno.test("empty + finish_reason=length DOUBLES the token budget on retry", async () => {
    const { openai, calls } = fakeOpenAI([
        { content: "", finish_reason: "length" },
        { content: '{"name":"ok"}' },
    ]);
    const out = await chatStructured({
        openai,
        model: "m",
        system: "s",
        user: "u",
        schema,
        mode: "json_object",
        maxTokens: 1000,
        maxRetries: 2,
        retryBaseMs: 1,
        logger: fakeLogger(),
    });
    assertEquals(out.name, "ok");
    assertEquals(calls[0].max_tokens, 1000);
    assertEquals(calls[1].max_tokens, 2000);
});

Deno.test("truncated (non-empty) JSON also escalates instead of 'repairing'", async () => {
    const { openai, calls } = fakeOpenAI([
        { content: '{"name":"tru', finish_reason: "length" },
        { content: '{"name":"ok"}' },
    ]);
    const out = await chatStructured({
        openai,
        model: "m",
        system: "s",
        user: "u",
        schema,
        mode: "json_object",
        maxTokens: 500,
        maxRetries: 2,
        retryBaseMs: 1,
        logger: fakeLogger(),
    });
    assertEquals(out.name, "ok");
    assertEquals(calls[1].max_tokens, 1000);
    assertEquals((calls[1].messages as unknown[]).length, 2);
});

Deno.test("the escalated budget is capped", async () => {
    const { openai, calls } = fakeOpenAI([
        { content: "", finish_reason: "length" },
        { content: "", finish_reason: "length" },
        { content: '{"name":"ok"}' },
    ]);
    await chatStructured({
        openai,
        model: "m",
        system: "s",
        user: "u",
        schema,
        mode: "json_object",
        maxTokens: 1000,
        maxTokensCap: 1500,
        maxRetries: 3,
        retryBaseMs: 1,
        logger: fakeLogger(),
    });
    assertEquals(calls[1].max_tokens, 1500);
    assertEquals(calls[2].max_tokens, 1500);
});
