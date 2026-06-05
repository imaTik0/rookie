/**
 * Runs the backend and frontend tasks in parallel.
 * Usage: deno run --allow-all scripts/run-both.ts [dev|start]
 *
 * dev   → backend: deno task watch   frontend: deno task dev
 * start → backend: deno task start   frontend: deno task preview
 *
 * If either process exits, the other is terminated and this script
 * exits with the same exit code.
 */

const mode = Deno.args[0] ?? "dev";
const backendTask = mode === "start" ? "start" : "watch";
const frontendTask = mode === "start" ? "preview" : "dev";

const rootDir = new URL("..", import.meta.url).pathname;
const frontendDir = new URL("../frontend", import.meta.url).pathname;

const backend = new Deno.Command("deno", {
    args: ["task", backendTask],
    cwd: rootDir,
    stdout: "inherit",
    stderr: "inherit",
}).spawn();

const frontend = new Deno.Command("deno", {
    args: ["task", frontendTask],
    cwd: frontendDir,
    stdout: "inherit",
    stderr: "inherit",
}).spawn();

const [status, other] = await Promise.race([
    backend.status.then((s) => [s, frontend] as const),
    frontend.status.then((s) => [s, backend] as const),
]);

try {
    other.kill("SIGTERM");
} catch {
    // already exited
}

Deno.exit(status.code);
