/**
 * Generic agentic tool-calling loop used by both the Research and Verification phases.
 * Eliminates duplication of the while-loop + tool-dispatch pattern.
 */
import OpenAI from "@openai/openai";
import { Logger } from "../../Logger.ts";
import { MODEL_NAME } from "./constants.ts";
import { ProgressCallback, emitLog } from "./helpers.ts";
import { AgenticLoopConfig } from "./types.ts";

export async function runAgenticLoop(
    openai: OpenAI,
    logger: Logger,
    onProgress: ProgressCallback,
    config: AgenticLoopConfig,
): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
    const { messages, tools, toolHandlers, readySignal, maxIterations, phaseLabel } = config;

    let iterations = 0;
    let isReady = false;

    while (iterations < maxIterations && !isReady) {
        logger.log(`${phaseLabel} Iteration ${iterations + 1}...`);
        emitLog(onProgress, `${phaseLabel} Iteration ${iterations + 1}...`);

        // Estimate tokens before sending to catch context bloat early
        const estimatedChars = messages.reduce((sum, m) => {
            const content = typeof m.content === "string" ? m.content : "";
            const toolCalls = (m as any).tool_calls ? JSON.stringify((m as any).tool_calls) : "";
            return sum + content.length + toolCalls.length;
        }, 0);
        const estimatedTokens = Math.ceil(estimatedChars / 4);
        logger.log(`${phaseLabel} estimated context: ~${estimatedTokens} tokens (${estimatedChars} chars, ${messages.length} messages)`);
        emitLog(onProgress, `Context size: ~${estimatedTokens} tokens (${messages.length} messages)`);

        const response = await openai.chat.completions.create({
            model: MODEL_NAME,
            messages,
            tools,
            tool_choice: "auto",
        });

        const message = response.choices[0].message;
        messages.push(message);

        // Stream the model's thoughts to the frontend
        if (message.content && !message.content.includes(readySignal)) {
            logger.log(`${phaseLabel} Agent Thoughts: ${message.content}`);
            emitLog(onProgress, `Agent Thoughts:\n${message.content}`);
        }

        if (message.tool_calls && message.tool_calls.length > 0) {
            for (const toolCall of message.tool_calls) {
                const handler = toolHandlers[toolCall.function.name];
                if (handler) {
                    const result = await handler(
                        toolCall.id,
                        JSON.parse(toolCall.function.arguments),
                    );
                    messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: result,
                    });
                }
            }
        } else if (message.content?.includes(readySignal)) {
            isReady = true;
        }

        iterations++;
    }

    return messages;
}
