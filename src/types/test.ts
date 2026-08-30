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
    /** Sandbox npm install pins/additions (name → version | "latest"), applied
     *  on top of the packages parsed from generated code. Used by the library
     *  drift experiment to install a specific `<pkg>@<version>` per phase. */
    packageOverrides?: Record<string, string>;
    /** Docs-ablation arm: generate code WITHOUT documentation (no RAG retrieval),
     *  so the agent must rely on parametric knowledge. `pass_with − pass_without`
     *  is the documentation's measured value. */
    withoutDocs?: boolean;
    /** Pre-generated programs to run VERBATIM instead of generating fresh code
     *  (frozen re-execution: the same code from the baseline run, executed against
     *  a new library version so drift is measured on identical code). */
    frozenPrograms?: string[];
    /** Documented API symbols this run is expected to exercise. Generated code
     *  that uses none of them is flagged as "dodged" (docs-faithfulness check). */
    expectedApis?: string[];
}
