// src/service/DockerExecutor.ts

export interface ExecutorConfig {
    memoryLimit: string;
    cpuLimit: string;
    timeoutMs: number;
    networkAccess: boolean;
    networkName?: string;
    // ─── Hardening (applied when `hardening` is true) ───────────────────────
    hardening: boolean;
    /** Numeric user[:group] to run as. Empty string = image default (usually root). */
    user: string;
    pidsLimit: number;
    /**
     * Budget for `npm install` (node only), SEPARATE from `timeoutMs`. Dependency
     * download time must not be subtracted from the program's own budget:
     * otherwise a slow registry turns working code into a bogus "timeout", which
     * downstream is misread as a documentation defect.
     */
    installTimeoutMs: number;
    /**
     * Max containers this process may run at once. The sandbox is bounded by the
     * Docker VM (not the host): oversubscribing it makes every container slower,
     * which manifests as spurious timeouts. Keep at or below the VM's capacity.
     */
    maxConcurrent: number;
}

/**
 * Marker for "the sandbox ran out of time". Recognised as an ENVIRONMENT error
 * (see sandbox/depDetect.ts) so a slow machine is never mistaken for a
 * documentation defect.
 */
export const SANDBOX_TIMEOUT = "ROOKIE_SANDBOX_TIMEOUT: execution timed out";

/** Force-remove a container by name (fire-and-forget; it may already be gone). */
function forceRemoveContainer(name: string): void {
    try {
        new Deno.Command("docker", {
            args: ["rm", "-f", name],
            stdout: "null",
            stderr: "null",
        }).spawn().status.catch(() => {});
    } catch { /* docker unavailable — nothing to clean */ }
}

// ── Global container semaphore ────────────────────────────────────────────────
// Shared by every DockerExecutor instance in the process: goals, examples and
// doc-example smoke tests all fan out with Promise.all, so without a single
// gate they can request far more CPU/RAM than the Docker VM owns.
let activeContainers = 0;
const containerQueue: Array<() => void> = [];

async function acquireSlot(limit: number): Promise<void> {
    if (activeContainers < limit) {
        activeContainers++;
        return;
    }
    await new Promise<void>((resolve) => containerQueue.push(resolve));
    activeContainers++;
}

function releaseSlot(): void {
    activeContainers--;
    containerQueue.shift()?.();
}

export interface ExecutionResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
    isTimeout: boolean;
}

export interface LanguageDefinition {
    image: string;
    command: string[];
}

export interface ExecuteOptions {
    timeoutMs?: number;
    /** Extra npm packages to install before running (node only). */
    packages?: string[];
    /** Bash commands to run before the program (node only) — e.g. create fixtures. */
    setup?: string;
}

export const LANGUAGES: Record<string, LanguageDefinition> = {
    python: { image: "python:3.10-alpine", command: ["python"] },
    node: { image: "node:24-slim", command: ["bash"] },
    cpp: {
        image: "gcc:12",
        command: ["sh", "-c", "cat > main.cpp && g++ main.cpp -o main && ./main"],
    },
    go: {
        image: "golang:1.21-alpine",
        command: ["sh", "-c", "cat > main.go && go run main.go"],
    },
    rust: {
        image: "rust:1.70-alpine",
        command: ["sh", "-c", "cat > main.rs && rustc main.rs && ./main"],
    },
};

export class DockerExecutor {
    private config: ExecutorConfig;

    constructor(config: Partial<ExecutorConfig> = {}) {
        this.config = {
            memoryLimit: "128m",
            cpuLimit: "0.5",
            timeoutMs: 5000,
            networkAccess: false,
            hardening: true,
            user: "1000:1000",
            pidsLimit: 256,
            installTimeoutMs: 180_000,
            maxConcurrent: 4,
            ...config,
        };
    }

    public async execute(
        lang: keyof typeof LANGUAGES | LanguageDefinition,
        code: string,
        timeoutOverrideOrOptions?: number | ExecuteOptions,
    ): Promise<ExecutionResult> {
        const options: ExecuteOptions = typeof timeoutOverrideOrOptions === "number"
            ? { timeoutMs: timeoutOverrideOrOptions }
            : (timeoutOverrideOrOptions || {});
        const langDef = typeof lang === "string" ? LANGUAGES[lang] : lang;
        if (!langDef) throw new Error(`Language '${lang}' not supported.`);

        const startTime = Date.now();
        const networkArg = this.config.networkName
            ? `--network=${this.config.networkName}`
            : (this.config.networkAccess ? "" : "--network=none");

        // Named so the container can be force-removed if it outlives its budget.
        // Killing the `docker run` CLI only detaches the client — the container
        // keeps running (observed: a sandbox alive for 38h), holding VM memory
        // and CPU and degrading every later run.
        const containerName = `rookie-sbx-${crypto.randomUUID().slice(0, 12)}`;

        const execBudgetMs = options.timeoutMs || this.config.timeoutMs;
        // Outer docker-level budget = install + execution. The program itself is
        // bounded to execBudgetMs *inside* the container (see buildNodeScript), so
        // a slow `npm install` can never eat the program's time.
        const isNode = lang === "node";
        const outerBudgetMs = isNode ? this.config.installTimeoutMs + execBudgetMs : execBudgetMs;

        const args = [
            "run",
            "-i",
            "--rm",
            "--name",
            containerName,
            `--memory=${this.config.memoryLimit}`,
            `--cpus=${this.config.cpuLimit}`,
            networkArg,
            ...this.hardeningArgs(),
            langDef.image,
            ...langDef.command,
        ].filter(Boolean);

        let finalStdinContent = code;
        if (isNode) {
            finalStdinContent = this.buildNodeScript(
                code,
                options.packages || [],
                options.setup,
                execBudgetMs,
            );
        }

        // Bound total concurrent containers process-wide (see maxConcurrent).
        await acquireSlot(this.config.maxConcurrent);

        const command = new Deno.Command("docker", {
            args: args,
            stdin: "piped",
            stdout: "piped",
            stderr: "piped",
        });

        const process = command.spawn();
        let isTimeout = false;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        try {
            const writer = process.stdin.getWriter();
            await writer.write(new TextEncoder().encode(finalStdinContent));
            await writer.close();

            timeoutId = setTimeout(() => {
                isTimeout = true;
                // Remove the CONTAINER, not just the local CLI, then kill the client.
                forceRemoveContainer(containerName);
                try {
                    process.kill();
                } catch { /* already exited */ }
            }, outerBudgetMs);

            const output = await process.output();

            const durationMs = Date.now() - startTime;
            const decoder = new TextDecoder();

            if (isTimeout) {
                return {
                    stdout: decoder.decode(output.stdout).trim(),
                    stderr: SANDBOX_TIMEOUT,
                    exitCode: -1,
                    durationMs,
                    isTimeout: true,
                };
            }

            const stderr = decoder.decode(output.stderr).trim();
            // `timeout` (coreutils) reports 124 on TERM, 137 on KILL — the program
            // itself exceeded its budget while dependencies installed fine.
            const codeTimedOut = output.code === 124 || output.code === 137;

            return {
                stdout: decoder.decode(output.stdout).trim(),
                stderr: codeTimedOut ? `${SANDBOX_TIMEOUT}\n${stderr}`.trim() : stderr,
                exitCode: output.code,
                durationMs,
                isTimeout: codeTimedOut,
            };
        } catch (error) {
            throw error;
        } finally {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
            releaseSlot();
        }
    }

    /**
     * Container hardening flags for running UNTRUSTED, AI-generated code.
     * Note on egress: full host-allowlisting cannot be done with plain `docker run`
     * flags. For real egress control, create `rookie-network` as an `--internal`
     * network plus an egress proxy, or set ROOKIE_SANDBOX_NETWORK_MODE=none for
     * offline library testing. These flags cover the in-container attack surface.
     */
    private hardeningArgs(): string[] {
        if (!this.config.hardening) return [];
        const args = [
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            `--pids-limit=${this.config.pidsLimit}`,
            // Read-only root FS; only the writable work area below is mutable.
            "--read-only",
            // World-writable tmpfs so a non-root user can build/run there.
            "--tmpfs=/eval:rw,exec,size=512m,mode=1777",
            "--tmpfs=/tmp:rw,exec,size=128m,mode=1777",
            "-w",
            "/eval",
            "-e",
            "HOME=/eval",
            "-e",
            "npm_config_cache=/eval/.npm",
        ];
        if (this.config.user) args.push("--user", this.config.user);
        return args;
    }

    private buildNodeScript(
        code: string,
        packages: string[],
        setup?: string,
        execBudgetMs?: number,
    ): string {
        const delimiter = crypto.randomUUID().replace(/-/g, "");
        const codeBlock = code.trim()
            ? `cat << '${delimiter}' > run.js\n${code}\n${delimiter}`
            : "";
        const setupBlock = setup && setup.trim() ? setup : "";

        // De-dupe + shell-safe quote each package spec.
        const uniquePkgs = [...new Set(packages.filter(Boolean))];
        const installBlock = uniquePkgs.length > 0
            ? `npm install --no-audit --no-fund --loglevel=error ${
                uniquePkgs.map((p) => `'${p.replace(/'/g, "")}'`).join(" ")
            } 2>&1 || echo "ROOKIE_NPM_INSTALL_FAILED"`
            : "";

        // When hardening is on the workdir/tmpfs are already prepared; otherwise mkdir.
        const prep = this.config.hardening ? "cd /eval" : "mkdir -p /eval && cd /eval";

        // The PROGRAM gets its own wall-clock budget, independent of how long the
        // dependency install took. `timeout` exits 124 (TERM) / 137 (KILL), which
        // the caller maps to a sandbox timeout rather than a code failure.
        const execSecs = Math.max(1, Math.ceil((execBudgetMs ?? 60_000) / 1000));
        const runCmd = `timeout -s KILL ${execSecs}s node run.js`;

        return `
set -e
${prep}
npm init -y > /dev/null 2>&1
npm pkg set type="module" > /dev/null 2>&1
${installBlock}
${setupBlock}
${codeBlock}
${runCmd}
`;
    }
}
