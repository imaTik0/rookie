/**
 * Unit tests for sandbox dependency detection. Pure — no infra.
 * Run with: deno test src/sandbox/depDetect.test.ts
 */
import { assert, assertArrayIncludes, assertEquals } from "@std/assert";
import { applyPackageOverrides, isEnvironmentError, parseImportedPackages } from "./depDetect.ts";

Deno.test("parseImportedPackages: all four import forms", () => {
    const code = `
        import _ from "lodash";
        import "side-effect-pkg";
        const d = await import('dayjs');
        const axios = require("axios");
    `;
    const pkgs = parseImportedPackages(code);
    assertArrayIncludes(pkgs, ["lodash", "side-effect-pkg", "dayjs", "axios"]);
});

Deno.test("parseImportedPackages: scoped packages reduce to @scope/name", () => {
    assertEquals(parseImportedPackages(`import x from "@scope/pkg/sub/deep";`), ["@scope/pkg"]);
});

Deno.test("parseImportedPackages: sub-paths reduce to the package name", () => {
    assertEquals(parseImportedPackages(`import x from "lodash/fp";`), ["lodash"]);
});

Deno.test("parseImportedPackages: excludes relative, absolute and protocol specifiers", () => {
    const code = `
        import a from "./local.js";
        import b from "../up.js";
        import c from "/abs/path.js";
        import fs from "node:fs";
        import data from "data:text/js,1";
        import http from "https://esm.sh/x";
    `;
    assertEquals(parseImportedPackages(code), []);
});

Deno.test("parseImportedPackages: excludes node builtins", () => {
    const code = `
        import fs from "fs";
        import path from "path";
        import { readFile } from "fs/promises";
        import crypto from "crypto";
    `;
    assertEquals(parseImportedPackages(code), []);
});

Deno.test("parseImportedPackages: de-duplicates repeated imports", () => {
    const code = `import a from "lodash"; const b = require("lodash");`;
    assertEquals(parseImportedPackages(code), ["lodash"]);
});

// ── applyPackageOverrides ─────────────────────────────────────────────────────

Deno.test("applyPackageOverrides: no overrides returns the parsed set unchanged", () => {
    assertEquals(applyPackageOverrides(["sequelize", "pg"]), ["sequelize", "pg"]);
    assertEquals(applyPackageOverrides(["sequelize"], {}), ["sequelize"]);
});

Deno.test("applyPackageOverrides: pins a parsed package to name@version", () => {
    assertEquals(
        applyPackageOverrides(["sequelize", "pg"], { sequelize: "5.22.5" }),
        ["sequelize@5.22.5", "pg"],
    );
});

Deno.test("applyPackageOverrides: force-adds override packages the code never imported", () => {
    // Sequelize's peer driver isn't imported by the example, but must install.
    const out = applyPackageOverrides(["sequelize"], {
        sequelize: "5.22.5",
        pg: "latest",
        "pg-hstore": "latest",
    });
    assertArrayIncludes(out, ["sequelize@5.22.5", "pg", "pg-hstore"]);
    assertEquals(out.length, 3);
});

Deno.test("applyPackageOverrides: a 'latest' override stays bare (npm installs latest)", () => {
    assertEquals(applyPackageOverrides(["pg"], { pg: "latest" }), ["pg"]);
});

Deno.test("applyPackageOverrides: override version wins over a duplicate parsed entry", () => {
    assertEquals(
        applyPackageOverrides(["typeorm", "typeorm"], { typeorm: "0.2.45" }),
        ["typeorm@0.2.45"],
    );
});

Deno.test("isEnvironmentError matches tooling/runtime signatures", () => {
    for (
        const sig of [
            "Error: Cannot find module 'dayjs'",
            "Cannot find package '@scope/x'",
            "code: ERR_MODULE_NOT_FOUND",
            "npm ERR! 404 Not Found",
            "bash: foo: command not found",
            "EACCES: permission denied",
            "Error: ENOSPC: no space left on device",
        ]
    ) {
        assert(isEnvironmentError(sig), `expected env error for: ${sig}`);
    }
});

Deno.test("isEnvironmentError rejects genuine documentation-gap errors", () => {
    assertEquals(isEnvironmentError("TypeError: client.fetchUser is not a function"), false);
    assertEquals(isEnvironmentError("HTTP 401 Unauthorized: missing token"), false);
    assertEquals(isEnvironmentError(""), false);
});

Deno.test("isEnvironmentError treats harness-contract violations as environment errors", () => {
    assert(isEnvironmentError("ROOKIE_NO_DEFAULT_EXPORT: the program must export default"));
    assert(
        isEnvironmentError(
            "ROOKIE_UNGROUNDED_SUCCESS: the program exited successfully but never made an HTTP request",
        ),
    );
});

// ── sandbox timeouts are NOT documentation defects ─────────────────────────────

Deno.test("a sandbox timeout is an ENVIRONMENT error, never a doc gap", () => {
    // Regression: "Execution timed out" was absent from the signature list, so a
    // slow npm install / oversubscribed Docker VM reached the LLM gap classifier
    // and was recorded as MISSING/INCORRECT/AMBIGUOUS — polluting the taxonomy
    // with machine load. Timeouts must short-circuit to ENVIRONMENT.
    assert(isEnvironmentError("ROOKIE_SANDBOX_TIMEOUT: execution timed out"));
    assert(isEnvironmentError("Execution timed out"));
});

Deno.test("genuine runtime errors still reach the documentation classifier", () => {
    assert(!isEnvironmentError("TypeError: client.query is not a function"));
    assert(!isEnvironmentError("AssertionError: expected 200, got 404"));
});

// ── prefix (family) version pinning ────────────────────────────────────────────

Deno.test("a `*` prefix rule pins a whole package family without installing itself", () => {
    // Regression: @mikro-orm/core@6.6.16 + @mikro-orm/postgresql@latest(7.x) makes
    // npm abort on ERESOLVE and install NOTHING, which surfaced at runtime as a
    // misleading "Cannot find package '@mikro-orm/core'".
    const parsed = ["@mikro-orm/core", "@mikro-orm/postgresql", "@mikro-orm/sqlite"];
    const out = applyPackageOverrides(parsed, {
        "@mikro-orm/core": "6.6.16",
        "@mikro-orm/postgresql": "6.6.16",
        "@mikro-orm/*": "6.6.16",
        "reflect-metadata": "latest",
    });
    // Every family package is version-matched, including the unforeseen sqlite one.
    assertArrayIncludes(out, [
        "@mikro-orm/core@6.6.16",
        "@mikro-orm/postgresql@6.6.16",
        "@mikro-orm/sqlite@6.6.16",
        "reflect-metadata",
    ]);
    // The wildcard key itself is never installed.
    assertEquals(out.some((p) => p.includes("*")), false);
});

Deno.test("an exact override still wins over a prefix rule", () => {
    const out = applyPackageOverrides(["@scope/a"], { "@scope/a": "1.2.3", "@scope/*": "9.9.9" });
    assertArrayIncludes(out, ["@scope/a@1.2.3"]);
});

Deno.test("a prefix rule does not affect unrelated packages", () => {
    const out = applyPackageOverrides(["pg", "@mikro-orm/core"], { "@mikro-orm/*": "6.6.16" });
    assertArrayIncludes(out, ["pg", "@mikro-orm/core@6.6.16"]);
});
