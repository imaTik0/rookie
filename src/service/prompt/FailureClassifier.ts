import OpenAI from "@openai/openai";
import { Logger } from "../../Logger.ts";
import { ConfigService } from "../ConfigService.ts";
import * as types from "../../types/index.ts";
import * as templates from "./templates.ts";
import * as schemas from "../../llm/schemas.ts";
import { majorityVote } from "../../eval/metrics.ts";
import { llmParams, makeStructured, type StructuredFn } from "./llm.ts";

export class FailureClassifier {
    private structured: StructuredFn;

    constructor(
        private openai: OpenAI,
        private configService: ConfigService,
        private logger: Logger,
    ) {
        this.structured = makeStructured(openai, configService, logger);
    }

    async refineSearchQuery(error: string, context: string): Promise<string> {
        const prompt = templates.createRefineSearchQueryPrompt(error, context);
        try {
            const response = await this.openai.chat.completions.create({
                model: this.configService.values.openAI.modelName,
                messages: [{ role: "user", content: prompt }],
                ...llmParams(this.configService),
                // deno-lint-ignore no-explicit-any
            } as any);
            return response.choices[0]?.message?.content?.trim() ||
                `${error} ${context}`.substring(0, 500);
        } catch (err) {
            this.logger.error(err, "Failed to refine search query");
            return `${error} ${context}`.substring(0, 500);
        }
    }

    async classify(
        errorMessage: string,
        scriptContent: string,
        relatedDocs: string,
        stepDescription: string,
        options: {
            fragmentScorer?: (fragment: string | undefined) => number;
        } = {},
        httpTrafficLog?: types.report.HttpTrafficEntry[],
    ): Promise<types.report.FailureAnalysis> {
        const httpSection = httpTrafficLog && httpTrafficLog.length > 0
            ? `\n\n### HTTP TRAFFIC DURING EXECUTION\n` +
                httpTrafficLog.slice(0, 20).map((e) =>
                    `${e.method} ${e.url} → ${e.responseStatus ?? e.error ?? "no response"}` +
                    (e.responseBody ? `\n  Response: ${e.responseBody.slice(0, 300)}` : "")
                ).join("\n")
            : "";

        const system =
            `You are a Documentation Quality Analyst. A code example that was written based on library documentation has CRASHED. Your job is to classify WHY it failed by comparing the error to the documentation.`;
        const user = `### THE ERROR
${errorMessage}

### THE CODE THAT CRASHED
${scriptContent}

### DOCUMENTATION CONTEXT
(Fragments retrieved for this error, plus — when available — the documentation the code
generator actually used. Quote pinpointed fragments VERBATIM from this context, never from memory.)
${relatedDocs || "No related documentation was found."}${httpSection}

### WHAT THE CODE WAS TRYING TO DO
${stepDescription}

### YOUR TASK
Determine:
1. Which function/method call caused the crash
2. Classify the documentationGap as exactly one of:
   - MISSING (no docs exist for this function)
   - AMBIGUOUS (docs exist but are unclear/confusing)
   - INCORRECT (docs say one thing but the library does another)
   - CONFIG (library needs configuration/setup that the docs omit)
   - ENVIRONMENT (the failure is a tooling/runtime problem — missing dependency, install failure, sandbox limit — NOT a documentation problem)
   - UNKNOWN (cannot determine)
3. Your reasoning
4. A concrete suggestion for how the documentation should be fixed
5. PINPOINTED FRAGMENT: Quote the RELEVANT SECTION from the documentation — NOT just a heading or anchor line.
   The fragment MUST include ALL of the following that are present in the docs:
     a) The endpoint/function heading and its description (1-3 sentences)
     b) All parameters or request body fields (name, type, required/optional, meaning)
     c) The return value / response schema description
     d) At least one code example if the docs provide one
   Format: "[filename]: <multi-line verbatim quote>"
   Minimum length: the fragment should be at least 5 meaningful lines unless the docs genuinely have less.
   WRONG ✗: "[api.md]: ## Create a repository"
   RIGHT ✓: "[api.md]: ## Create a repository\\nCreate a new repository for the specified user.\\n\\n**Parameters**\\n- 'owner' (string, required): ...\\n- 'name' (string, required): ..."
6. PROPOSED FRAGMENT: A corrected/improved version of that documentation section (same multi-line format).

Respond with a JSON object:
{
    "errorMessage": "the key error line",
    "failedFunction": "the function/method that crashed",
    "documentationGap": "MISSING | AMBIGUOUS | INCORRECT | CONFIG | ENVIRONMENT | UNKNOWN",
    "reasoning": "why you classified it this way",
    "suggestedDocsFix": "concrete suggestion for documentation improvement",
    "pinpointedFragment": "exact multi-line quote from the docs (minimum 5 lines)",
    "proposedFragment": "corrected multi-line version of the documentation section"
}`;

        const votes = this.configService.values.classifier.votes;
        const settled = await Promise.allSettled(
            Array.from(
                { length: votes },
                (_, i) =>
                    this.structured(system, user, schemas.FailureAnalysisSchema)
                        .catch((err) => {
                            this.logger.error(err, `Failed to classify failure (vote ${i + 1})`);
                            return null;
                        }),
            ),
        );
        const candidates: types.report.FailureAnalysis[] = settled
            .map((r) => (r.status === "fulfilled" ? r.value : null))
            .filter((v): v is types.report.FailureAnalysis => v !== null);

        if (candidates.length === 0) {
            return {
                errorMessage: errorMessage.substring(0, 200),
                failedFunction: "unknown",
                documentationGap: "UNKNOWN",
                reasoning: "Classification failed due to LLM error",
                suggestedDocsFix: "Manual review required",
                confidence: 0,
                votes: 0,
            };
        }

        const winningGap = majorityVote(candidates.map((c) => c.documentationGap));
        const winners = candidates.filter((c) => c.documentationGap === winningGap);
        const scorer = options.fragmentScorer;
        const representative = scorer
            ? [...winners].sort(
                (a, b) => scorer(b.pinpointedFragment) - scorer(a.pinpointedFragment),
            )[0]
            : winners[0];

        return {
            ...(representative ?? candidates[0]),
            confidence: Math.round((winners.length / candidates.length) * 1000) / 1000,
            votes: candidates.length,
        };
    }
}
