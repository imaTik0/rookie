export type TestSuiteId = string & { __testSuiteId: never };

import { ProjectId } from "./project.ts";

export interface TestSuite {
    _id: TestSuiteId;
    projectId: ProjectId;
    mode: "CODE_GENERATION" | "TEST_SCENARIO";
    userGoal?: string;
    initialContext: string;
    minimalStoryLength?: number;
    maximalStoryLength?: number;
}
