import { VectorCollectionFactory } from "../db/vectordb/VectorCollectionFactory.ts";
import { Logger } from "../Logger.ts";
import * as types from "../types/index.ts";
import { EmbeddingService } from "./EmbeddingService.ts";
import { FileService } from "./FileService.ts";
import { ProjectRepository } from "./ProjectRepository.ts";
import { PromptService } from "./PromptService.ts";
import { TestSuiteRepository } from "./TestSuiteRepository.ts";
import { DockerExecutor } from "./DockerExecutor.ts";

export class Executor {
    // 1. We keep a single instance of DockerExecutor
    private dockerExecutor: DockerExecutor;

    constructor(
        private testSuiteRepository: TestSuiteRepository,
        private promptService: PromptService,
        private projectRepository: ProjectRepository,
        private fileService: FileService,
        private logger: Logger,
        private vectorCollectionFactory: VectorCollectionFactory,
        private embeddingService: EmbeddingService,
        // Optional: Allow injecting config, otherwise defaults
        // dockerConfig?: any
    ) {
        this.dockerExecutor = new DockerExecutor({
            timeoutMs: 10000,
            memoryLimit: "256m",
            networkAccess: true,
            networkName: "rookie-network",
        });
    }

    /**
     * Executes a single script file path (Optional: adapt to Docker if needed,
     * but usually this is for internal tool scripts, so local import might remain).
     */
    async executeScript(path: string, ctx: any) {
        const module = await import(path);
        return await module.default(ctx);
    }

    async executeTestSuite(testSuiteId: types.test.TestSuiteId) {
        const testSuite = await this.testSuiteRepository.get(testSuiteId);
        if (!testSuite) return null;

        const project = await this.projectRepository.get(testSuite.projectId);
        if (!project) return null;

        // 1. Prepare Data
        const files = await Promise.all(
            project.files.map((file) => this.fileService.downloadFile(file)),
        );

        // 2. Generate Plan (Prompt)
        const result = await this.promptService.promptForApiUsageScenario(
            files.filter((file) => !!file).map((file) => file.buffer.toString()).join("\n"),
            testSuite.initialContext,
        );

        // Debug output
        await Deno.writeTextFile("result.json", JSON.stringify(result, null, 2));

        const fails = [];
        // Initialize Context
        let context = JSON.parse(testSuite.initialContext);
        let i = 0;

        // 3. Execution Loop
        for (const call of result.calls) {
            i++;
            await Deno.writeTextFile(`./f${i}.js`, call.fetch);

            const stepResult = await this.runStepInDocker(call.fetch, context);

            if (stepResult.success && stepResult.result) {
                context = stepResult.result.ctx;
                this.logger.log(`Step ${i} success.`);
            } else {
                // --- ZMIANA: Bezpieczne logowanie błędu ---
                const errorToLog = typeof stepResult.error === "object"
                    ? JSON.stringify(stepResult.error, null, 2)
                    : stepResult.error;

                this.logger.error(`Step ${i} failed: ${errorToLog}`);

                fails.push({
                    stepExplanation: call.stepExplanation,
                    error: errorToLog, // Zapisujemy jako string w raporcie
                });
            }
        }

        // 4. Handle Failures (Vector Search)
        if (fails.length > 0) {
            const vCollection = await this.vectorCollectionFactory.createCollection(
                testSuite.projectId,
            );
            const failsRelatedDocs = [];
            for (const fail of fails) {
                const embededFail = await this.embeddingService.embed(fail.stepExplanation);
                const related = await vCollection.search(embededFail[0], 3);
                failsRelatedDocs.push(related);
            }
            await Deno.writeTextFile("fails.json", JSON.stringify(fails, null, 2));
            await Deno.writeTextFile("related.json", JSON.stringify(failsRelatedDocs, null, 2));
        }

        return result;
    }

    private async runStepInDocker(
        userCode: string,
        currentCtx: unknown,
    ): Promise<{ success: boolean; result?: { ctx: unknown; result: unknown }; error?: unknown }> {
        const cleanedUserCode = userCode.replace("export default", "const runStep =");

        const script = `
            const ctx = ${JSON.stringify(currentCtx)};
            const { inspect } = require('util');

            ${cleanedUserCode}

            (async () => {
                try {
                    const output = await runStep(ctx);
                    console.log("___RESULT_START___");
                    console.log(JSON.stringify(output));
                    console.log("___RESULT_END___");
                } catch (e) {
                    let serializableError = {};

                    if (e instanceof Error) {
                        // 1. Pobierz standardowe pola (które nie są 'enumerable' i nie wchodzą same do JSON)
                        serializableError = {
                            message: e.message,
                            name: e.name,
                            stack: e.stack,
                            cause: e.cause // Często zawiera przyczynę błędów sieciowych
                        };

                        // 2. Pobierz WSZYSTKIE dodatkowe pola doklejone do obiektu Error
                        // (np. e.code, e.response, e.data - częste w bibliotekach HTTP)
                        Object.assign(serializableError, e);

                        // 3. Ratunek dla "[object Object]"
                        // Jeśli wiadomość jest zepsuta, użyj util.inspect, aby podejrzeć surowy obiekt w logach
                        if (e.message === '[object Object]') {
                            serializableError.debug_inspect = inspect(e, { depth: 3, colors: false });
                        }
                    } else if (typeof e === 'object' && e !== null) {
                        // Jeśli rzucono czysty obiekt (throw { error: ... })
                        serializableError = e;
                    } else {
                        // Stringi i inne typy proste
                        serializableError = { message: String(e) };
                    }

                    // Wypisz jako JSON na stderr
                    console.error(JSON.stringify(serializableError));
                    process.exit(1);
                }
            })();
        `;

        try {
            const execResult = await this.dockerExecutor.execute("node", script);

            if (execResult.exitCode !== 0) {
                let parsedError = execResult.stderr;
                try {
                    // Próbujemy sparsować JSON z stderr
                    parsedError = JSON.parse(execResult.stderr);
                } catch {
                    // Fallback jeśli stderr to jednak zwykły tekst
                }
                return { success: false, error: parsedError };
            }

            const stdout = execResult.stdout;
            const startMarker = "___RESULT_START___";
            const endMarker = "___RESULT_END___";

            const startIndex = stdout.indexOf(startMarker);
            const endIndex = stdout.indexOf(endMarker);

            if (startIndex === -1 || endIndex === -1) {
                return {
                    success: false,
                    error: "Script executed but returned no result structure. Output: " + stdout,
                };
            }

            const jsonStr = stdout.substring(startIndex + startMarker.length, endIndex).trim();
            const resultData = JSON.parse(jsonStr);

            return { success: true, result: resultData };
        } catch (error: any) {
            this.logger.error(error, "Docker execution system exception:");
            return { success: false, error: error.message };
        }
    }
}
