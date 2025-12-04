import { VectorCollectionFactory } from "../db/vectordb/VectorCollectionFactory.ts";
import { Logger } from "../Logger.ts";
import * as types from "../types/index.ts";
import { Utils } from "../Utils.ts";
import { EmbeddingService } from "./EmbeddingService.ts";
import { FileService } from "./FileService.ts";
import { ProjectRepository } from "./ProjectRepository.ts";
import { PromptService } from "./PromptService.ts";
import { TestSuiteRepository } from "./TestSuiteRepository.ts";

export class Executor {
    constructor(
        private testSuiteRepository: TestSuiteRepository,
        private promptService: PromptService,
        private projectRepository: ProjectRepository,
        private fileService: FileService,
        private logger: Logger,
        private vectorCollectionFactory: VectorCollectionFactory,
        private embeddingService: EmbeddingService,
    ) {}

    async executeScript(path: string, ctx: any) {
        const module = await import(path);
        return await module.default(ctx);
    }

    async executeTestSuite(testSuiteId: types.test.TestSuiteId) {
        const testSuite = await this.testSuiteRepository.get(testSuiteId);
        if (!testSuite) {
            return null;
        }
        const project = await this.projectRepository.get(testSuite.projectId);
        if (!project) {
            return null;
        }
        const files = await Promise.all(
            project.files.map((file) => this.fileService.downloadFile(file)),
        );
        const result = await this.promptService.promptForApiUsageScenario(
            files.filter((file) => !!file).map((file) => file.buffer.toString()).join("\n"),
            testSuite.initialContext,
        );
        Deno.writeTextFile("result.json", JSON.stringify(result, null, 2));
        const fails = [];
        let context = JSON.parse(testSuite.initialContext);
        let i = 0;
        for (const call of result.calls) {
            i++;
            Deno.writeTextFile(`./f${i}.js`, call.fetch);
            const step = await this.importFromString(call.fetch);
            const stepResult = await Utils.tryPromise(() => step(context));
            if (stepResult.success && stepResult.result) {
                context = stepResult.result.ctx;
            } else {
                fails.push({
                    stepExplanation: call.stepExplanation,
                    error: JSON.stringify(stepResult.error),
                });
            }
        }
        const vCollection = await this.vectorCollectionFactory.createCollection(
            testSuite.projectId,
        );
        const failsRelatedDocs = [];
        for (const fail of fails) {
            const embededFail = await this.embeddingService.embed(fail.stepExplanation);
            const related = await vCollection.search(embededFail[0], 3);
            failsRelatedDocs.push(related);
        }
        Deno.writeTextFile("fails.json", JSON.stringify(fails, null, 2));
        Deno.writeTextFile("related.json", JSON.stringify(failsRelatedDocs, null, 2));
        return result;
    }

    async importFromString(
        codeString: string,
    ): Promise<(ctx: unknown) => Promise<{ result: unknown; ctx: unknown }>> {
        try {
            const dataUrl = `data:text/javascript,${encodeURIComponent(codeString)}`;
            const module = await import(dataUrl);
            return module.default;
        } catch (error) {
            this.logger.error(error, "Failed to dynamically import string:");
            throw new Error(`Dynamic import failed: ${error}`);
        }
    }
}
