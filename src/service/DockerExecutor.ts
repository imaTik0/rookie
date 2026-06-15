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
    node: { image: "node:20-slim", command: ["bash"] },
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

        const args = [
            "run",
            "-i",
            "--rm",
            `--memory=${this.config.memoryLimit}`,
            `--cpus=${this.config.cpuLimit}`,
            networkArg,
            ...this.hardeningArgs(),
            langDef.image,
            ...langDef.command,
        ].filter(Boolean);

        const command = new Deno.Command("docker", {
            args: args,
            stdin: "piped",
            stdout: "piped",
            stderr: "piped",
        });

        const process = command.spawn();
        let isTimeout = false;
        let timeoutId: any;

        let finalStdinContent = code;
        if (lang === "node") {
            finalStdinContent = this.buildNodeScript(code, options.packages || [], options.setup);
        }

        try {
            const writer = process.stdin.getWriter();
            await writer.write(new TextEncoder().encode(finalStdinContent));
            await writer.close();

            timeoutId = setTimeout(() => {
                isTimeout = true;
                process.kill();
            }, options.timeoutMs || this.config.timeoutMs);

            const output = await process.output();

            const durationMs = Date.now() - startTime;
            const decoder = new TextDecoder();

            if (isTimeout) {
                return {
                    stdout: decoder.decode(output.stdout).trim(),
                    stderr: "Execution timed out",
                    exitCode: -1,
                    durationMs,
                    isTimeout: true,
                };
            }

            return {
                stdout: decoder.decode(output.stdout).trim(),
                stderr: decoder.decode(output.stderr).trim(),
                exitCode: output.code,
                durationMs,
                isTimeout: false,
            };
        } catch (error) {
            throw error;
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
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

    private buildNodeScript(code: string, packages: string[], setup?: string): string {
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

        return `
set -e
${prep}
npm init -y > /dev/null 2>&1
npm pkg set type="module" > /dev/null 2>&1
${installBlock}
${setupBlock}
${codeBlock}
node run.js
`;
    }
}
