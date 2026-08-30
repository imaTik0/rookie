import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { DockerExecutor } from "./DockerExecutor.ts";
import { dockerAvailable } from "../testing/infra.ts";

const HAS_DOCKER = await dockerAvailable();

Deno.test("hardeningArgs include cap-drop, read-only, pids-limit and user", () => {
    // deno-lint-ignore no-explicit-any
    const args = (new DockerExecutor({ hardening: true, user: "1000:1000", pidsLimit: 256 }) as any)
        .hardeningArgs();
    assertStringIncludes(args.join(" "), "--cap-drop=ALL");
    assertStringIncludes(args.join(" "), "--read-only");
    assertStringIncludes(args.join(" "), "--pids-limit=256");
    assertStringIncludes(args.join(" "), "--user 1000:1000");
});

Deno.test("hardeningArgs are empty when hardening is disabled", () => {
    // deno-lint-ignore no-explicit-any
    assertEquals((new DockerExecutor({ hardening: false }) as any).hardeningArgs(), []);
});

Deno.test("hardeningArgs omit --user when user is empty", () => {
    // deno-lint-ignore no-explicit-any
    const args: string[] = (new DockerExecutor({ hardening: true, user: "" }) as any)
        .hardeningArgs();
    assert(!args.includes("--user"));
});

Deno.test("buildNodeScript installs de-duplicated packages and runs the code", () => {
    // deno-lint-ignore no-explicit-any
    const script: string = (new DockerExecutor() as any).buildNodeScript(
        "console.log(1)",
        ["lodash", "lodash", "axios"],
        'echo "setup"',
    );
    assertStringIncludes(script, "npm install");
    assertStringIncludes(script, "'lodash'");
    assertStringIncludes(script, "'axios'");
    assertEquals(script.match(/'lodash'/g)!.length, 1);
    assertStringIncludes(script, 'echo "setup"');
    assertStringIncludes(script, "node run.js");
});

Deno.test("buildNodeScript omits the install line when there are no packages", () => {
    // deno-lint-ignore no-explicit-any
    const script: string = (new DockerExecutor() as any).buildNodeScript(
        "console.log(1)",
        [],
        undefined,
    );
    assert(!script.includes("npm install"));
});

Deno.test({ name: "[docker] runs Node.js code", ignore: !HAS_DOCKER }, async () => {
    const r = await new DockerExecutor({ timeoutMs: 15000 }).execute(
        "node",
        `console.log("hi from node")`,
    );
    assertEquals(r.exitCode, 0);
    assertStringIncludes(r.stdout, "hi from node");
});

Deno.test({ name: "[docker] captures a Node SyntaxError", ignore: !HAS_DOCKER }, async () => {
    const r = await new DockerExecutor({ timeoutMs: 15000 }).execute(
        "node",
        `function broken() { return ; `,
    );
    assert(r.exitCode !== 0);
    assertStringIncludes(r.stderr, "SyntaxError");
});

Deno.test({ name: "[docker] enforces the execution timeout", ignore: !HAS_DOCKER }, async () => {
    const r = await new DockerExecutor({ timeoutMs: 1000 }).execute(
        "python",
        "import time\ntime.sleep(3)\nprint('nope')",
    );
    assertEquals(r.isTimeout, true);
    assertEquals(r.exitCode, -1);
});

Deno.test({ name: "[docker] runs bash setup before Node code", ignore: !HAS_DOCKER }, async () => {
    const r = await new DockerExecutor({ timeoutMs: 15000 }).execute(
        "node",
        `import fs from 'fs'; console.log("F:", fs.readFileSync('s.txt','utf8').trim());`,
        { setup: `echo "seed" > s.txt` },
    );
    assertEquals(r.exitCode, 0);
    assertStringIncludes(r.stdout, "F: seed");
});
