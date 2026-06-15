/**
 * Unit tests for sandbox dependency detection. Pure — no infra.
 * Run with: deno test src/sandbox/depDetect.test.ts
 */
import { assert, assertArrayIncludes, assertEquals } from "@std/assert";
import { isEnvironmentError, parseImportedPackages } from "./depDetect.ts";

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
