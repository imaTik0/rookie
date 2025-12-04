import * as db from "../db/mongo/Model.ts";
import { TestSuiteRepository } from "./TestSuiteRepository.ts";
import * as types from "../types/index.ts";
import { UpdateTestSuiteDTO } from "../api/testsuite/TestSuiteSchema.ts";

export class TestSuiteService {
    constructor(
        private testSuiteRepository: TestSuiteRepository,
    ) {}

    async createTestSuite(
        projectId: types.project.ProjectId,
        initialContext: string,
        functionTemplate: string,
        minimalStoryLength: number,
        maximalStoryLength: number,
    ) {
        const data = {
            projectId,
            initialContext,
            functionTemplate,
            minimalStoryLength,
            maximalStoryLength,
        };
        const newDbSuite = await this.testSuiteRepository.create(data);
        return this.mapDbToApi(newDbSuite);
    }

    async getTestSuite(testSuiteId: types.test.TestSuiteId) {
        const dbSuite = await this.testSuiteRepository.get(testSuiteId);
        if (!dbSuite) {
            return null;
        }
        return this.mapDbToApi(dbSuite);
    }

    async listTestSuites(
        pagination: { page: number; limit: number },
    ) {
        const { testSuites: dbSuites, total } = await this.testSuiteRepository.list(pagination);
        return { testSuites: dbSuites.map((test) => this.mapDbToApi(test)), total };
    }

    async updateTestSuite(testSuiteId: types.test.TestSuiteId, data: UpdateTestSuiteDTO) {
        const updatedDbSuite = await this.testSuiteRepository.update(
            testSuiteId,
            {
                functionTemplate: data.functionTemplate,
                initialContext: data.initialContext,
                maximalStoryLength: data.maximalStoryLength,
                minimalStoryLength: data.maximalStoryLength,
                projectId: data.projectId as types.project.ProjectId,
            },
        );
        if (!updatedDbSuite) {
            return null;
        }
        return this.mapDbToApi(updatedDbSuite);
    }

    async deleteTestSuite(
        testSuiteId: types.test.TestSuiteId,
    ): Promise<boolean> {
        return await this.testSuiteRepository.delete(testSuiteId);
    }

    private mapDbToApi(
        model: db.TestSuite,
    ) {
        return {
            id: model._id,
            projectId: model.projectId,
            initialContext: model.initialContext,
            functionTemplate: model.functionTemplate,
            minimalStoryLength: model.minimalStoryLength,
            maximalStoryLength: model.maximalStoryLength,
            createdAt: model.createdAt.toISOString(),
            updatedAt: model.updatedAt.toISOString(),
        };
    }
}
