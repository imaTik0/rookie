import * as db from "../db/mongo/Model.ts";
import { TestSuiteRepository } from "./TestSuiteRepository.ts";
import * as types from "../types/index.ts";
import { CreateTestSuiteDTO, UpdateTestSuiteDTO } from "../api/testsuite/TestSuiteSchema.ts";

export class TestSuiteService {
    constructor(
        private testSuiteRepository: TestSuiteRepository,
    ) {}

    async createTestSuite(
        data: CreateTestSuiteDTO,
    ) {
        const newDbSuite = await this.testSuiteRepository.create({
            projectId: data.projectId as types.project.ProjectId,
            initialContext: data.initialContext,
            functionTemplate: data.functionTemplate,
            minimalStoryLength: data.minimalStoryLength,
            maximalStoryLength: data.maximalStoryLength,
            mode: data.mode as "CODE_GENERATION" | "TEST_SCENARIO",
            userGoal: data.userGoal,
        });
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
        filter: { projectId?: types.project.ProjectId } = {},
    ) {
        const { testSuites: dbSuites, total } = await this.testSuiteRepository.list(
            pagination,
            filter,
        );
        return { testSuites: dbSuites.map((test) => this.mapDbToApi(test)), total };
    }

    async updateTestSuite(testSuiteId: types.test.TestSuiteId, data: UpdateTestSuiteDTO) {
        const updatedDbSuite = await this.testSuiteRepository.update(
            testSuiteId,
            {
                functionTemplate: data.functionTemplate,
                initialContext: data.initialContext,
                maximalStoryLength: data.maximalStoryLength,
                minimalStoryLength: data.minimalStoryLength,
                projectId: data.projectId as types.project.ProjectId,
                mode: data.mode as "CODE_GENERATION" | "TEST_SCENARIO",
                userGoal: data.userGoal,
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
            mode: model.mode,
            userGoal: model.userGoal,
            createdAt: model.createdAt.toISOString(),
            updatedAt: model.updatedAt.toISOString(),
        };
    }
}
