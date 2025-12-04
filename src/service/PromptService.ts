import OpenAI from "@openai/openai";
import { Logger } from "../Logger.ts";

export interface StructuredResponse {
    calls: {
        stepExplanation: string;
        fetch: string;
        returnValueName: string;
    }[];
}

export class PromptService {
    constructor(
        private openai: OpenAI,
        private logger: Logger,
    ) {}

    private createPromptTemplate(
        userInput: string,
        startingContext: string,
        functionTemplate?: string,
        minimalLength?: number,
        maximalLength?: number,
    ): string {
        const jsonStructure: StructuredResponse = {
            calls: [{
                fetch:
                    `There should be ready to eval javascript code calling api function with fetch API that is encapsulated in function with template:  
                        ${
                        functionTemplate || `
                            export default async (ctx) => {
                                const response = await fetch(ctx.url, {});
                                const result = await response.json();
                                if (result.error) {
                                    throw new Error(JSON.stringify(result.error, null, 2));
                                }
                                ctx.$$VARIABLE.foo = bar
                                return {result, ctx};
                            }    
                        `
                    }
                    `,
                stepExplanation: "Description of action",
                returnValueName:
                    "Name of variable that holds result of fetch, it will be referenced as $$VARIABLE",
            }],
        };

        return `
      Analyze the following documentation. Prepare user story in form of ${
            minimalLength || 10
        } to ${maximalLength || 20} api method calls that resemble
      potenial usage of following API. Your response MUST be a valid JSON object that strictly
      adheres to the structure shown below. Do not include any explanations or markdown
      formatting outside of the JSON object itself. You MUST follow JSON RPC 2.0 Protocol and response with VALID json
      array of calls that follows structure below. You can reference values returned by specific calls using ctx.$$VARIABLE notation
	  and use standard library of enviroment (node.js) for operations that require it. DO NOT USE any variables that are not a part of
	  initial context object or returned in previous steps

      JSON Structure to follow:
      ${JSON.stringify(jsonStructure, null, 2)}

      API's Documentation to Analyze:
      ---
      ${userInput}
      ---

	  Starting context object:
	  ---
	  ${startingContext}
	  ---

    `;
    }

    public async promptForApiUsageScenario(
        docs: string,
        startingContext: string,
        functionTemplate?: string,
        minimalLength?: number,
        maximalLength?: number,
    ): Promise<StructuredResponse> {
        const prompt = this.createPromptTemplate(
            docs,
            startingContext,
            functionTemplate,
            minimalLength,
            maximalLength,
        );

        try {
            this.logger.log("Prompting gpt...");
            const response = await this.openai.chat.completions.create({
                model: "gpt-5-mini",
                messages: [
                    {
                        role: "developer",
                        content:
                            "You are an experienced developer that is reading documentation of new tool, you only responds with perfectly formatted JSON.",
                    },
                    {
                        role: "developer",
                        content: prompt,
                    },
                ],
                response_format: { type: "json_object" },
            });

            const jsonString = response.choices[0]?.message?.content;

            if (!jsonString) {
                throw new Error("Received an empty response from OpenAI.");
            }

            return JSON.parse(jsonString) as StructuredResponse;
        } catch (error) {
            console.error("Error communicating with OpenAI:", error);
            throw new Error("Failed to get a structured response from OpenAI.");
        }
    }
}
