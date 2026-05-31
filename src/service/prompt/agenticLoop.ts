/**
 * Generic agentic tool-calling loop used by both the Research and Verification phases.
 * Eliminates duplication of the while-loop + tool-dispatch pattern.
 */
import OpenAI from "@openai/openai";
import { Logger } from "../../Logger.ts";
import { emitLog, ProgressCallback } from "./helpers.ts";
import { AgenticLoopConfig } from "./types.ts";
import { withRetry } from "../../llm/retry.ts";
import { countMessageTokens } from "../../llm/tokens.ts";

/**
 * Non-destructive context pruning. Instead of erasing old messages to
 * "[PRUNED]", it compacts long, OLD tool/assistant contents to a head+tail
 * excerpt so the most informative parts (signatures, error headers) survive.
 * tool_calls are preserved untouched to keep tool_call/tool pairing valid.
 */
function compactExcerpt(text: string, head = 400, tail = 200): string {
    if (text.length <= head + tail + 40) return text;
    const removed = text.length - head - tail;
    return `${text.slice(0, head)}\n…[${removed} chars trimmed to save context]…\n${
        text.slice(text.length - tail)
    }`;
}

function pruneMessages(messages: OpenAI.Chat.ChatCompletionMessageParam[], tokenBudget: number) {
    // Keep system + first user (0,1) and the last 4 messages full; compact the rest.
    for (let i = 2; i < messages.length - 4; i++) {
        const m = messages[i] as any;
        if (typeof m.content === "string" && m.content.length > 300) {
            const compacted = compactExcerpt(m.content);
            if (compacted.length < m.content.length) m.content = compacted;
        }
    }
    return countContextTokens(messages) <= tokenBudget;
}

function countContextTokens(messages: OpenAI.Chat.ChatCompletionMessageParam[]): number {
    return messages.reduce((sum, m) => sum + countMessageTokens(m as any), 0);
}

function safeParse(json: string): unknown {
    try {
        return JSON.parse(json || "{}");
    } catch {
        return { _raw: json };
    }
}

export async function runAgenticLoop(
    openai: OpenAI,
    logger: Logger,
    onProgress: ProgressCallback,
    config: AgenticLoopConfig,
): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
    const { modelName, messages, tools, toolHandlers, readySignal, maxIterations, phaseLabel, onTrace } = config;

    let iterations = 0;
    let isReady = false;

    // Token budget: explicit setting, else derive from the char budget (~4 chars/token).
    const tokenBudget = config.maxContextTokens ??
        (config.maxContextChars ? Math.floor(config.maxContextChars / 4) : Infinity);

    while (iterations < maxIterations && !isReady) {
        logger.log(`${phaseLabel} Iteration ${iterations + 1}...`);
        emitLog(onProgress, `${phaseLabel} Iteration ${iterations + 1}...`);

        // Accurate token accounting via a real tokenizer.
        let contextTokens = countContextTokens(messages);
        logger.log(
            `${phaseLabel} context: ~${contextTokens} tokens (${messages.length} messages)`,
        );
        emitLog(onProgress, `Context size: ~${contextTokens} tokens (${messages.length} messages)`);

        if (contextTokens > tokenBudget && messages.length > 4) {
            logger.log(`${phaseLabel} Token budget exceeded, compacting older interactions...`);
            emitLog(onProgress, `Token budget exceeded, compacting older interactions...`);
            pruneMessages(messages, tokenBudget);
            contextTokens = countContextTokens(messages);
            emitLog(onProgress, `Context compacted to ~${contextTokens} tokens.`);
        }

        const response = await withRetry(
            () =>
                openai.chat.completions.create({
                    model: modelName,
                    messages,
                    tools,
                    tool_choice: "auto",
                    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
                    ...(config.seed !== undefined ? { seed: config.seed } : {}),
                } as any),
            {
                retries: config.maxRetries ?? 3,
                baseDelayMs: config.retryBaseMs,
                label: `${phaseLabel} chat.completions`,
                logger,
            },
        );

        const message = (response as any).choices[0].message;
        messages.push(message);

        if (onTrace) {
            await onTrace({
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                type: "LLM_CALL",
                content: {
                    messages: messages.slice(0, -1),
                    response: message,
                    phase: phaseLabel
                },
                tokens: response.usage ? {
                    promptTokens: response.usage.prompt_tokens,
                    completionTokens: response.usage.completion_tokens,
                    totalTokens: response.usage.total_tokens
                } : undefined
            });
        }

        // Stream the model's thoughts to the frontend
        if (message.content && !message.content.includes(readySignal)) {
            logger.log(`${phaseLabel} Agent Thoughts: ${message.content}`);
            emitLog(onProgress, `Agent Thoughts:\n${message.content}`);
        }

        if (message.tool_calls && message.tool_calls.length > 0) {
            for (const toolCall of message.tool_calls) {
                const handler = toolHandlers[toolCall.function.name];
                if (handler) {
                    // Guard the handler so a thrown error (bad args JSON, search
                    // failure, etc.) becomes a tool result the model can react to,
                    // instead of crashing the whole loop.
                    let result: string;
                    try {
                        const args = JSON.parse(toolCall.function.arguments || "{}");
                        result = await handler(toolCall.id, args);
                    } catch (err) {
                        result = `TOOL_ERROR: ${(err as Error)?.message ?? String(err)}`;
                        logger.error(err, `${phaseLabel} tool '${toolCall.function.name}' failed`);
                    }
                    messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: result,
                    });
                    if (onTrace) {
                        await onTrace({
                            id: crypto.randomUUID(),
                            timestamp: Date.now(),
                            type: "TOOL_CALL",
                            content: {
                                tool: toolCall.function.name,
                                args: safeParse(toolCall.function.arguments),
                                result: result,
                                phase: phaseLabel
                            }
                        });
                    }
                }
            }
        } else if (message.content?.includes(readySignal) || message.content?.includes("NEEDS_RESEARCH:")) {
            isReady = true;
        }

        iterations++;
    }

    return messages;
}
