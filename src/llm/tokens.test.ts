/**
 * Unit tests for token counting helpers. Pure — no infra.
 * Run with: deno test src/llm/tokens.test.ts
 */
import { assert, assertEquals } from "@std/assert";
import { countMessageTokens, countTokens } from "./tokens.ts";

Deno.test("countTokens is zero for empty input", () => {
    assertEquals(countTokens(""), 0);
});

Deno.test("countTokens grows with text length", () => {
    const short = countTokens("hello");
    const long = countTokens("hello world this is a longer sentence with many tokens");
    assert(short > 0);
    assert(long > short);
});

Deno.test("countMessageTokens adds per-message framing overhead", () => {
    const content = "fetch the user";
    const msg = countMessageTokens({ content });
    // content tokens + ~4 framing tokens
    assertEquals(msg, countTokens(content) + 4);
});

Deno.test("countMessageTokens counts serialized tool_calls", () => {
    const withTools = countMessageTokens({
        content: "",
        tool_calls: [{ function: { name: "search", arguments: '{"query":"x"}' } }],
    });
    const plain = countMessageTokens({ content: "" });
    assert(withTools > plain);
});

Deno.test("countMessageTokens tolerates non-string content", () => {
    // Non-string content contributes 0 content tokens, only framing remains.
    assertEquals(countMessageTokens({ content: undefined }), 4);
});
