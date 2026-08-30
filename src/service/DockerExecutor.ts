export interface ExecutorConfig {
    memoryLimit: string;
    cpuLimit: string;
    timeoutMs: number;
    networkAccess: boolean;
    networkName?: string;
    hardening: boolean;
    user: string;
    pidsLimit: number;
    installTimeoutMs: number;
    maxConcurrent: number;
}

export const SANDBOX_TIMEOUT = "ROOKIE_SANDBOX_TIMEOUT: execution timed out";

function forceRemoveContainer(name: string): void {
    try {
        new Deno.Command("docker", {
            args: ["rm", "-f", name],
            stdout: "null",
            stderr: "null",
        }).spawn().status.catch(() => {});
    } catch { /* docker unavailable — nothing to clean */ }
}

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
    packages?: string[];
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

        const containerName = `rookie-sbx-${crypto.randomUUID().slice(0, 12)}`;

        const execBudgetMs = options.timeoutMs || this.config.timeoutMs;
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

    private hardeningArgs(): string[] {
        if (!this.config.hardening) return [];
        const args = [
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            `--pids-limit=${this.config.pidsLimit}`,
            "--read-only",
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

        const uniquePkgs = [...new Set(packages.filter(Boolean))];
        const installBlock = uniquePkgs.length > 0
            ? `npm install --no-audit --no-fund --loglevel=error ${
                uniquePkgs.map((p) => `'${p.replace(/'/g, "")}'`).join(" ")
            } 2>&1 || echo "ROOKIE_NPM_INSTALL_FAILED"`
            : "";

        const prep = this.config.hardening ? "cd /eval" : "mkdir -p /eval && cd /eval";

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
