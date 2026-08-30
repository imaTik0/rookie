import { assertEquals } from "@std/assert";
import { Utils } from "./Utils.ts";

Deno.test("sha256 matches the known NIST vector for 'abc'", async () => {
    assertEquals(
        await Utils.sha256("abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
});

Deno.test("sha256 is hex-encoded and 64 chars", async () => {
    const h = await Utils.sha256("rookie");
    assertEquals(h.length, 64);
    assertEquals(/^[0-9a-f]{64}$/.test(h), true);
});

Deno.test("tryPromise wraps a resolved value", async () => {
    const r = await Utils.tryPromise(() => Promise.resolve(42));
    assertEquals(r.success, true);
    assertEquals((r as { result: number }).result, 42);
});

Deno.test("tryPromise captures a rejection without throwing", async () => {
    const boom = new Error("boom");
    const r = await Utils.tryPromise(() => Promise.reject(boom));
    assertEquals(r.success, false);
    assertEquals((r as { error: unknown }).error, boom);
});
