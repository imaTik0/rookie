export type TestSuiteId = string & { __testSuiteId: never };

export interface TestSuite {
    _id: TestSuiteId;
    projectId: string;
    mode: "CODE_GENERATION" | "TEST_SCENARIO";
    userGoal?: string;
    initialContext: string;
    minimalStoryLength?: number;
    maximalStoryLength?: number;
}
