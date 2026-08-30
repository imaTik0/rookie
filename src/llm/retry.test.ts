import { assert, assertEquals, assertRejects } from "@std/assert";
import { isRetryableError, withRetry } from "./retry.ts";

Deno.test("isRetryableError: HTTP status codes", () => {
    assert(isRetryableError({ status: 429 }));
    assert(isRetryableError({ status: 408 }));
    assert(isRetryableError({ status: 500 }));
    assert(isRetryableError({ status: 503 }));
    assert(isRetryableError({ response: { status: 502 } }));
    assertEquals(isRetryableError({ status: 400 }), false);
    assertEquals(isRetryableError({ status: 404 }), false);
    assertEquals(isRetryableError({ status: 401 }), false);
});

Deno.test("isRetryableError: network error messages", () => {
    for (
        const msg of [
            "ECONNRESET",
            "ETIMEDOUT",
            "fetch failed",
            "socket hang up",
            "rate limit exceeded",
            "overloaded",
        ]
    ) {
        assert(isRetryableError(new Error(msg)), `expected retryable: ${msg}`);
    }
    assertEquals(isRetryableError(new Error("invalid argument")), false);
});

Deno.test("withRetry returns immediately on success", async () => {
    let calls = 0;
    const r = await withRetry(() => {
        calls++;
        return Promise.resolve("ok");
    }, { retries: 3, baseDelayMs: 1 });
    assertEquals(r, "ok");
    assertEquals(calls, 1);
});

Deno.test("withRetry retries transient failures then succeeds", async () => {
    let calls = 0;
    const r = await withRetry(() => {
        calls++;
        if (calls < 3) return Promise.reject({ status: 429 });
        return Promise.resolve("recovered");
    }, { retries: 3, baseDelayMs: 1 });
    assertEquals(r, "recovered");
    assertEquals(calls, 3);
});

Deno.test("withRetry exhausts retries then throws (retries + 1 attempts)", async () => {
    let calls = 0;
    await assertRejects(() =>
        withRetry(() => {
            calls++;
            return Promise.reject({ status: 503 });
        }, { retries: 2, baseDelayMs: 1 })
    );
    assertEquals(calls, 3);
});

Deno.test("withRetry rethrows non-retryable errors immediately", async () => {
    let calls = 0;
    await assertRejects(() =>
        withRetry(() => {
            calls++;
            return Promise.reject({ status: 400 });
        }, { retries: 5, baseDelayMs: 1 })
    );
    assertEquals(calls, 1);
});
