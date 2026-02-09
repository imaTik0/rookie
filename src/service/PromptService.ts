import OpenAI from "@openai/openai";
import { Logger } from "../Logger.ts";

export interface StructuredResponse {
    calls: {
        stepExplanation: string;
        fetch: string;
        returnValueName: string;
    }[];
}

export interface PromptOptions {
    minimalLength?: number;
    maximalLength?: number;
    userPreferences?: string;
    mandatoryImports?: string;
}

export class PromptService {
    constructor(
        private openai: OpenAI,
        private logger: Logger,
    ) {}

    private createSystemPrompt(mandatoryImports: string = ""): string {
        return `
### ROLE
You are a Senior Test Automation Engineer. Your goal is to plan a comprehensive test scenario and generate executable JavaScript steps to **test the product**.

### EXECUTION ENVIRONMENT (CRITICAL)
1. **Universal JavaScript:** Your code must be compatible with **BOTH Node.js and Browser** environments.
2. **Forbidden Globals:** - ❌ DO NOT use \`Buffer\` (Node-specific). 
   - ✅ USE \`Uint8Array\` for binary data.
3. **Context ('ctx'):** - State passed between steps. 
   - **Constraint:** Pure JSON data only. No sockets, functions, or class instances.
   - You MUST re-establish connections/setup in every step using configuration stored in 'ctx'.

### IMPORT RULES
You may assume the following imports are present and available for use. 
**CONSTRAINT:** You must include these lines at the top of your file, but **DO NOT import anything else on your own**.

\`\`\`javascript
${mandatoryImports}
\`\`\`

### CODE STRUCTURE (THE CONTRACT)
You must generate code that strictly follows this structure:

1. **MAIN FUNCTION:** Export a default async function that accepts \`ctx\`.
2. **DOCUMENTATION COMPLIANCE:** Adhere strictly to the provided API documentation. Do not invent methods that do not exist in the docs.
3. **ERROR HANDLING:**
   - If an API result indicates failure (e.g., \`result.error\`), you MUST throw an Error.
   - **Rule:** You MUST stringify the error object: \`throw new Error(JSON.stringify(result.error, null, 2));\`
4. **RETURN SIGNATURE:**
   Return an object: \`{ result: <api_response>, ctx: <updated_context> }\`.

### TEMPLATE VISUALIZATION
Your output for the \`fetch\` field in the JSON response must look exactly like this:

\`\`\`javascript
${mandatoryImports}

export default async (ctx) => {
    // 1. Re-connect / Setup using ctx data
    // const api = await someImportedLibrary.setup(ctx.apiKey) ... or fetch(ctx.url)

    // 2. Perform Action (Test the product)
    // const response = await api.doSpecificAction(...);

    // 3. Defensive Check
    if (response.error) {
        throw new Error(JSON.stringify(response.error, null, 2));
    }

    // 4. Update Context
    ctx.lastResult = response.data;

    // 5. Return
    return { result: response, ctx };
}
\`\`\`
`;
    }

    private createUserPrompt(
        docs: string,
        startingContext: string,
        config: PromptOptions,
    ): string {
        const min = config.minimalLength || 10;
        const max = config.maximalLength || 20;

        const jsonStructureExample = {
            calls: [{
                stepExplanation: "Detailed description of the test step",
                fetch: "The complete JavaScript source code (imports + export default)",
                returnValueName: "variableName",
            }],
        };

        return `
### TASK
Analyze the provided documentation and prepare a test scenario consisting of **${min} to ${max} steps**.

### INPUT DATA

**1. API Documentation (Source of Truth):**
---
${docs}
---

**2. Starting Context:**
---
${startingContext}
---

**3. User Preferences:**
---
${config.userPreferences || "No specific preferences."}
---

### OUTPUT
Respond with a **valid JSON object** (no markdown formatting).
Structure:
${JSON.stringify(jsonStructureExample, null, 2)}
`;
    }

    public async promptForApiUsageScenario(
        docs: string,
        startingContext: string,
        options: PromptOptions = {},
    ): Promise<StructuredResponse> {
        const systemPrompt = this.createSystemPrompt(options.mandatoryImports);
        const userPrompt = this.createUserPrompt(docs, startingContext, options);

        try {
            this.logger.log(
                `Prompting OpenAI (Steps: ${options.minimalLength || 10}-${
                    options.maximalLength || 20
                })...`,
            );

            const response = await this.openai.chat.completions.create({
                model: "gpt-5-mini",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt },
                ],
                response_format: { type: "json_object" },
                // temperature: 0.2,
            });

            const jsonString = response.choices[0]?.message?.content;
            if (!jsonString) throw new Error("Received empty response from OpenAI.");

            return JSON.parse(jsonString) as StructuredResponse;
        } catch (error) {
            this.logger.error(error, "Error communicating with OpenAI");
            throw new Error("Failed to get response from OpenAI.");
        }
    }
}
