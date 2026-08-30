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

export const CoverageReportSchema = z.object({
    items: z.array(z.object({
        subtask: z.string(),
        covered: z.boolean().optional().default(true),
        queriesUsed: z.array(z.string()).optional().default([]),
        missingInfo: z.string().optional(),
    })).default([]),
});

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
