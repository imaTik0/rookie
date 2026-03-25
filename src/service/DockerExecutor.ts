// src/service/DockerExecutor.ts

export interface ExecutorConfig {
    memoryLimit: string;
    cpuLimit: string;
    timeoutMs: number;
    networkAccess: boolean;
    networkName?: string;
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

export const LANGUAGES: Record<string, LanguageDefinition> = {
    python: { image: "python:3.10-alpine", command: ["python"] },
    node: { image: "node:20-alpine", command: ["sh"] },
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
    browser: {
        image: "mcr.microsoft.com/playwright:v1.49.1-focal",
        command: ["sh"],
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
            ...config,
        };
    }

    public async execute(
        lang: keyof typeof LANGUAGES | LanguageDefinition,
        code: string,
        dependencies: string[] = []
    ): Promise<ExecutionResult> {
        const langDef = typeof lang === "string" ? LANGUAGES[lang] : lang;
        if (!langDef) throw new Error(`Language '${lang}' not supported.`);

        const startTime = Date.now();
        const networkArg = this.config.networkName
            ? `--network=${this.config.networkName}`
            : (this.config.networkAccess ? "" : "--network=none");

        // Playwright typically requires higher memory IPC limits
        const capAddArg = lang === "browser" ? "--ipc=host" : "";

        const args = [
            "run",
            "-i",
            "--rm",
            `--memory=${this.config.memoryLimit}`,
            `--cpus=${this.config.cpuLimit}`,
            networkArg,
            capAddArg,
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
        if (lang === "node" || lang === "browser") {
            const depsInstall = dependencies.length > 0
                ? `npm install ${dependencies.join(" ")} > /dev/null 2>&1`
                : "";
                
            finalStdinContent = `
mkdir -p /eval && cd /eval
npm init -y > /dev/null 2>&1
npm pkg set type="module"
${depsInstall}
cat << 'ENDEVALCODE' > run.js
${code}
ENDEVALCODE
node run.js
`;
        }

        try {
            const writer = process.stdin.getWriter();
            await writer.write(new TextEncoder().encode(finalStdinContent));
            await writer.close();

            timeoutId = setTimeout(() => {
                isTimeout = true;
                process.kill();
            }, this.config.timeoutMs);

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
}
