/**
 * Zod schemas for every structured LLM output. These are the single source of
 * truth for validation: the StructuredLlm helper parses model JSON against them
 * and repairs on mismatch, so a stray field or wrong shape from a small local
 * model no longer crashes the pipeline or silently corrupts data.
 *
 * Only widely-stable zod APIs are used (object/string/number/array/enum/
 * optional/default) so behaviour is identical across zod minor versions.
 */
import { z } from "zod";

export const GAP_ENUM = z.enum([
    "MISSING",
    "AMBIGUOUS",
    "INCORRECT",
    "CONFIG",
    "ENVIRONMENT",
    "UNKNOWN",
]);

export const RouterPlanSchema = z.object({
    steps: z.array(z.object({
        stepExplanation: z.string(),
        action: z.string(),
    })).default([]),
});

export const ScenarioSchema = z.object({
    calls: z.array(z.object({
        stepExplanation: z.string(),
        fetch: z.string(),
        returnValueName: z.string().optional().default("result"),
    })).default([]),
});

export const CodeGenerationSchema = z.object({
    examples: z.array(z.object({
        title: z.string(),
        explanation: z.string(),
        fullProgram: z.string(),
    })).default([]),
    finalMarkdownSummary: z.string().optional().default(""),
});

export const GoalsSchema = z.object({
    goals: z.array(z.string()).default([]),
});

export const FailureAnalysisSchema = z.object({
    errorMessage: z.string().optional().default(""),
    failedFunction: z.string().optional().default("unknown"),
    documentationGap: GAP_ENUM,
    reasoning: z.string().optional().default(""),
    suggestedDocsFix: z.string().optional().default(""),
    pinpointedFragment: z.string().optional(),
    proposedFragment: z.string().optional(),
});

/** Research-phase coverage extraction: which decomposed sub-tasks the docs covered. */
export const CoverageReportSchema = z.object({
    items: z.array(z.object({
        subtask: z.string(),
        covered: z.boolean().optional().default(true),
        queriesUsed: z.array(z.string()).optional().default([]),
        missingInfo: z.string().optional(),
    })).default([]),
});

// Master summary is rich; validate the scalar core, accept nested lists loosely
// (they are only rendered, never branched on).
export const MasterSummarySchema = z.object({
    executiveSummary: z.string().optional().default(""),
    overallPassRate: z.number().optional().default(0),
    failureTaxonomy: z.record(z.string(), z.number()).optional().default({}),
    topFailingFunctions: z.array(z.unknown()).optional().default([]),
    goalsBreakdown: z.array(z.unknown()).optional().default([]),
    documentationGapDetails: z.array(z.unknown()).optional().default([]),
    recommendations: z.array(z.string()).optional().default([]),
});

export type CoverageReport = z.infer<typeof CoverageReportSchema>;
export type RouterPlan = z.infer<typeof RouterPlanSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
export type CodeGeneration = z.infer<typeof CodeGenerationSchema>;
export type Goals = z.infer<typeof GoalsSchema>;
export type FailureAnalysisOut = z.infer<typeof FailureAnalysisSchema>;
export type MasterSummary = z.infer<typeof MasterSummarySchema>;
