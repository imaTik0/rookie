/**
 * Unit tests for grounded-success enforcement. Pure — no infra.
 * Run with: deno test src/sandbox/grounding.test.ts
 */
import { assert, assertEquals } from "@std/assert";
import {
    extractApiHosts,
    isGrounded,
    UNGROUNDED_SUCCESS,
    ungroundedSuccessError,
} from "./grounding.ts";
import type * as types from "../types/index.ts";

function entry(url: string, over: Partial<types.report.HttpTrafficEntry> = {}) {
    return { method: "GET", url, ...over } as types.report.HttpTrafficEntry;
}

// ── extractApiHosts ───────────────────────────────────────────────────────────

Deno.test("extractApiHosts collects hostnames from URL values, including nested ones", () => {
    const hosts = extractApiHosts({
        baseUrl: "http://host.docker.internal:14000",
        apiBase: "http://host.docker.internal:14000/api/v1",
        nested: { docs: "https://docs.example.com/guide" },
        list: ["https://alt.example.org/x"],
        token: "abc123",
        n: 42,
    });
    assertEquals(
        hosts,
        new Set(["host.docker.internal", "docs.example.com", "alt.example.org"]),
    );
});

Deno.test("extractApiHosts is empty for library-style contexts (no URLs)", () => {
    assertEquals(extractApiHosts({ token: "x", user: "y" }).size, 0);
    assertEquals(extractApiHosts({}).size, 0);
    assertEquals(extractApiHosts(null).size, 0);
    assertEquals(extractApiHosts("not a url").size, 0);
});

Deno.test("extractApiHosts ignores non-http schemes and malformed URLs", () => {
    const hosts = extractApiHosts({
        a: "ftp://files.example.com",
        b: "mongodb://db:27017",
        c: "http://", // malformed
    });
    assertEquals(hosts.size, 0);
});

Deno.test("extractApiHosts survives circular contexts", () => {
    // deno-lint-ignore no-explicit-any
    const ctx: any = { apiBase: "http://api.local:8080" };
    ctx.self = ctx;
    assertEquals(extractApiHosts(ctx), new Set(["api.local"]));
});

// ── isGrounded ────────────────────────────────────────────────────────────────

Deno.test("isGrounded: no declared hosts -> always grounded (library testing)", () => {
    assert(isGrounded(new Set(), undefined));
    assert(isGrounded(new Set(), []));
});

Deno.test("isGrounded: declared hosts + no traffic -> not grounded", () => {
    const hosts = new Set(["api.local"]);
    assertEquals(isGrounded(hosts, undefined), false);
    assertEquals(isGrounded(hosts, []), false);
});

Deno.test("isGrounded: a call to a declared host counts, regardless of port", () => {
    const hosts = new Set(["host.docker.internal"]);
    assert(isGrounded(hosts, [entry("http://host.docker.internal:14000/api/v1/users")]));
    assert(isGrounded(hosts, [entry("http://host.docker.internal:9999/other")]));
});

Deno.test("isGrounded: a FAILED call to the declared host still grounds the run", () => {
    const hosts = new Set(["api.local"]);
    assert(
        isGrounded(hosts, [
            entry("http://api.local/api/v2/write", { error: "ECONNREFUSED", responseStatus: null }),
        ]),
    );
});

Deno.test("isGrounded: calls only to undeclared hosts do not ground the run", () => {
    const hosts = new Set(["api.local"]);
    assertEquals(isGrounded(hosts, [entry("https://example.com/mock")]), false);
});

// ── ungroundedSuccessError ────────────────────────────────────────────────────

Deno.test("ungroundedSuccessError carries the marker and the declared hosts", () => {
    const msg = ungroundedSuccessError(new Set(["api.local", "db.local"]));
    assert(msg.startsWith(UNGROUNDED_SUCCESS));
    assert(msg.includes("api.local, db.local"));
});
