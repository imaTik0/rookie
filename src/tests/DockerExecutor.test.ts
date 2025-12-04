// src/tests/DockerExecutor.test.ts
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { DockerExecutor } from "../service/DockerExecutor.ts";

async function checkDockerAvailability() {
    const command = new Deno.Command("docker", { args: ["--version"] });
    try {
        const output = await command.output();
        if (output.code !== 0) {
            console.error("SKIPPING: Docker returned error code.");
            Deno.exit(0);
        }
    } catch (e) {
        console.error("SKIPPING: Docker not found.");
        Deno.exit(0);
    }
}

await checkDockerAvailability();

Deno.test("DockerExecutor - Python (Interpreted)", async (t) => {
    const executor = new DockerExecutor();
    const code = `print("Hello from Python")`;

    await t.step("should execute simple code successfully", async () => {
        const result = await executor.execute("python", code);
        assertEquals(result.exitCode, 0);
        assertStringIncludes(result.stdout, "Hello from Python");
    });
});

Deno.test("DockerExecutor - C++ (Compiled)", async (t) => {
    const executor = new DockerExecutor({ timeoutMs: 60000 });

    const code = `
    #include <iostream>
    int main() {
        std::cout << "Hello from C++" << std::endl;
        return 0;
    }
  `;

    await t.step("should compile and run successfully", async () => {
        const result = await executor.execute("cpp", code);

        if (result.exitCode !== 0) {
            console.error("C++ Error Output:", result.stderr);
        }

        assertEquals(result.exitCode, 0);
        assertStringIncludes(result.stdout, "Hello from C++");
    });

    await t.step("should capture compilation errors", async () => {
        const brokenCode = `int main() { return 0; `;
        const result = await executor.execute("cpp", brokenCode);
        assert(result.exitCode !== 0);
        assert(result.stderr.length > 0);
    });
});

Deno.test("DockerExecutor - Timeout Handling", async () => {
    const executor = new DockerExecutor({ timeoutMs: 1000 });

    const slowCode = `
import time
time.sleep(2)
print("Should not happen")
  `;

    const result = await executor.execute("python", slowCode);

    assertEquals(result.isTimeout, true);
    assertStringIncludes(result.stderr, "Execution timed out");
    assertEquals(result.exitCode, -1);
});

Deno.test("DockerExecutor - Configuration limits", async () => {
    const executor = new DockerExecutor({
        memoryLimit: "64m",
        cpuLimit: "0.25",
    });

    const code = `print("Low resource run")`;
    const result = await executor.execute("python", code);

    assertEquals(result.exitCode, 0);
    assertStringIncludes(result.stdout, "Low resource run");
});

Deno.test("DockerExecutor - Node.js (Interpreted)", async (t) => {
    const executor = new DockerExecutor({ timeoutMs: 10000 });

    await t.step("should execute simple console.log successfully", async () => {
        const code = `console.log("Hello from Node.js container");`;
        const result = await executor.execute("node", code);

        assertEquals(result.exitCode, 0);
        assertStringIncludes(result.stdout, "Hello from Node.js container");
    });

    await t.step("should handle complex logic (JSON & Array)", async () => {
        const code = `
      const data = [1, 2, 3, 4, 5];
      const sum = data.reduce((a, b) => a + b, 0);
      console.log(JSON.stringify({ sum, message: "Done" }));
    `;
        const result = await executor.execute("node", code);

        assertEquals(result.exitCode, 0);
        assertStringIncludes(result.stdout, '{"sum":15,"message":"Done"}');
    });

    await t.step("should capture SyntaxError in stderr", async () => {
        const code = `function broken() { return ; `;
        const result = await executor.execute("node", code);

        assert(result.exitCode !== 0, "Exit code should be non-zero on syntax error");
        assertStringIncludes(result.stderr, "SyntaxError");
    });

    await t.step("should handle async operations", async () => {
        const code = `
        setTimeout(() => {
            console.log("Async Hello");
        }, 100);
    `;
        const result = await executor.execute("node", code);

        assertEquals(result.exitCode, 0);
        assertStringIncludes(result.stdout, "Async Hello");
    });
});
