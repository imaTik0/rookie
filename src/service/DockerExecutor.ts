// docker_executor.ts

// --- Konfiguracja (bez zmian) ---

export interface ExecutorConfig {
    memoryLimit: string;
    cpuLimit: string;
    timeoutMs: number;
    networkAccess: boolean;
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

// --- Definicje Języków ---

export const LANGUAGES: Record<string, LanguageDefinition> = {
    python: { image: "python:3.10-alpine", command: ["python"] },
    node: { image: "node:20-alpine", command: ["node"] },
    // Kompilowane (bash wrapper)
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

// --- Klasa Executora (Deno Version) ---

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
    ): Promise<ExecutionResult> {
        const langDef = typeof lang === "string" ? LANGUAGES[lang] : lang;
        if (!langDef) throw new Error(`Language '${lang}' not supported.`);

        const startTime = Date.now();

        const args = [
            "run",
            "-i",
            "--rm",
            `--memory=${this.config.memoryLimit}`,
            `--cpus=${this.config.cpuLimit}`,
            this.config.networkAccess ? "" : "--network=none",
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
        let timeoutId: number | undefined;

        try {
            // 1. Piszemy kod na STDIN
            const writer = process.stdin.getWriter();
            await writer.write(new TextEncoder().encode(code));
            await writer.close();

            // 2. Ustawiamy Timeout, który ZABIJA proces
            // Nie używamy Promise.race. Po prostu jeśli czas minie, strzelamy kill().
            // To spowoduje, że process.output() poniżej zakończy się natychmiast.
            timeoutId = setTimeout(() => {
                isTimeout = true;
                process.kill();
            }, this.config.timeoutMs);

            // 3. Czekamy na naturalne zakończenie procesu (lub zabicie przez timeout)
            // process.output() automatycznie zamyka i czyta strumienie stdout/stderr
            const output = await process.output();

            const durationMs = Date.now() - startTime;
            const decoder = new TextDecoder();

            // Jeśli był timeout, zwracamy odpowiedni status, mimo że mamy output (często pusty)
            if (isTimeout) {
                return {
                    stdout: decoder.decode(output.stdout).trim(),
                    stderr: "Execution timed out", // Nadpisujemy stderr informacją o błędzie
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
        } catch (error: any) {
            // Ten blok łapie błędy systemowe (np. nie udało się w ogóle uruchomić dockera)
            throw error;
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
    }
}
