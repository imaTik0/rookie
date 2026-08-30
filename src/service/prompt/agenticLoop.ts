/**
 * Generic agentic tool-calling loop used by both the Research and Verification phases.
 *
 * Context management strategy
 * ───────────────────────────
 * When the token budget is exceeded we apply three passes in order:
 *
 *  Pass 1 — Compact string content: replace long tool-response strings with
 *            a head+tail excerpt (fast, no LLM call, preserves structure).
 *
 *  Pass 2 — LLM distillation: extract all old tool-call groups (assistant
 *            message + its tool responses), summarise them with a dedicated
 *            LLM call, then replace the groups with a single dense factsheet.
 *            Falls back to a plain drop if the summarisation call fails.
 *            This preserves information density rather than discarding content.
 *
 *  Pass 3 — Initial-context truncation: if still over budget, compact the
 *            initial user/docs message (message[1]) with head+tail excerpts.
 *            The model can still query the RAG for details it needs.
 */
import OpenAI from "@openai/openai";
import { Logger } from "../../Logger.ts";
import {
    emitAssistantEnd,
    emitLog,
    emitPhase,
    emitToken,
    emitToolCall,
    emitToolResult,
    ProgressCallback,
} from "./helpers.ts";
import { AgenticLoopConfig } from "./types.ts";
import { withRetry } from "../../llm/retry.ts";
import { countMessageTokens, countTokens } from "../../llm/tokens.ts";

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

// Minimal structural type covering the OpenAI message union without `any`.
interface AgentMessage {
    role: string;
    content?: string | null;
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    tool_call_id?: string;
}

interface ToolGroup {
    thoughts: string;
    calls: Array<{ name: string; args: Record<string, unknown> }>;
    results: string[];
}

function asAgentMsg(m: OpenAI.Chat.ChatCompletionMessageParam): AgentMessage {
    return m as unknown as AgentMessage;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Token counting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Count tokens for the full API request: messages + tool definitions.
 *
 * Tool definitions are NOT part of the messages array but are included in
 * every API call. Anthropic serialises them as XML inside the system prompt,
 * so their actual token cost exceeds raw JSON. ×1.5 is a conservative
 * multiplier that avoids underestimating and hitting the model context limit.
 */
function countContextTokens(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    tools?: OpenAI.Chat.ChatCompletionTool[],
): number {
    const msgTokens = messages.reduce(
        (sum, m) => sum + countMessageTokens(m as { content?: unknown; tool_calls?: unknown }),
        0,
    );
    const toolTokens = tools ? Math.ceil(countTokens(JSON.stringify(tools)) * 1.5) : 0;
    return msgTokens + toolTokens;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Context helpers
// ─────────────────────────────────────────────────────────────────────────────

function compactExcerpt(text: string, head = 400, tail = 200): string {
    if (text.length <= head + tail + 40) return text;
    return `${text.slice(0, head)}\n…[${text.length - head - tail} chars trimmed]…\n${
        text.slice(text.length - tail)
    }`;
}

/**
 * Walk messages[from..to) and extract contiguous tool-call groups.
 * A group = one assistant message with tool_calls + its matching tool responses.
 * Returns the structured groups AND the flat list of indices they occupy.
 */
function extractToolGroups(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    from: number,
    to: number,
): { groups: ToolGroup[]; indices: number[] } {
    const groups: ToolGroup[] = [];
    const indices: number[] = [];
    let i = from;

    while (i < to) {
        const m = asAgentMsg(messages[i]);
        if (m.role !== "assistant" || !Array.isArray(m.tool_calls) || m.tool_calls.length === 0) {
            i++;
            continue;
        }

        const group: ToolGroup = {
            thoughts: m.content ?? "",
            calls: m.tool_calls.map((tc) => {
                let args: Record<string, unknown> = {};
                try {
                    args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
                } catch { /* ignore */ }
                return { name: tc.function.name, args };
            }),
            results: [],
        };
        const callIds = new Set(m.tool_calls.map((tc) => tc.id));
        const groupIdx = [i];
        i++;

        while (i < to && callIds.size > 0) {
            const tm = asAgentMsg(messages[i]);
            if (tm.role === "tool" && tm.tool_call_id && callIds.has(tm.tool_call_id)) {
                group.results.push(typeof tm.content === "string" ? tm.content : "");
                callIds.delete(tm.tool_call_id);
                groupIdx.push(i);
                i++;
            } else {
                break;
            }
        }

        groups.push(group);
        indices.push(...groupIdx);
    }

    return { groups, indices };
}

/**
 * Summarise an array of tool-call groups into a compact factsheet using the
 * LLM. The model understands API documentation structure and produces output
 * that is far more information-dense than any heuristic truncation strategy:
 * exact endpoint paths, parameter names and types, auth requirements, examples.
 */
async function distillGroupsToSummary(
    openai: OpenAI,
    modelName: string,
    callTimeoutMs: number,
    groups: ToolGroup[],
    logger?: { error: (...args: any[]) => void },
): Promise<string> {
    const formatted = groups.map((g, idx) => {
        const queries = g.calls.map((c) => String(c.args.query ?? c.name)).join("; ");
        const resultSnippets = g.results
            .map((r) => r.slice(0, 900).replace(/\s+/g, " ").trim())
            .join("\n");
        const lines = [`### Step ${idx + 1}: searched for "${queries}"`];
        if (resultSnippets) lines.push(resultSnippets);
        if (g.thoughts) lines.push(`Reasoning: ${g.thoughts.slice(0, 400)}`);
        return lines.join("\n");
    }).join("\n\n");

    const response = await openai.chat.completions.create(
        {
            model: modelName,
            messages: [
                {
                    role: "system",
                    content: "You are a technical API research distiller. " +
                        "Extract EVERY concrete fact: endpoint paths, HTTP methods, " +
                        "required/optional parameters with exact names and types, " +
                        "authentication headers and schemes, request body field names, " +
                        "response field names, status codes, and constraints. " +
                        "Output a numbered bullet list. Preserve exact names verbatim. " +
                        "Be dense — do not paraphrase when a name or type can be quoted directly.",
                },
                {
                    role: "user",
                    content:
                        `Distill the following research steps into a compact factsheet:\n\n${formatted}`,
                },
            ],
            // Headroom for "reasoning" models: they spend tokens on internal
            // thinking before emitting content, so a tight cap here returned an
            // EMPTY factsheet (silently degrading research quality). The output
            // itself stays short — the extra budget only covers the thinking.
            max_tokens: 4000,
        },
        { signal: AbortSignal.timeout(callTimeoutMs) },
    );

    const factsheet = response.choices[0].message.content?.trim() ?? "";
    if (!factsheet) {
        logger?.error(
            `Context compaction produced an EMPTY factsheet ` +
                `(finish_reason=${response.choices[0].finish_reason}); ` +
                `research context for this phase may be degraded.`,
        );
    }
    return factsheet;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Pruning orchestrator
// ─────────────────────────────────────────────────────────────────────────────

async function pruneMessages(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    tokenBudget: number,
    openai: OpenAI,
    modelName: string,
    callTimeoutMs: number,
    logger: Logger,
    phaseLabel: string,
    onProgress: ProgressCallback | undefined,
    tools?: OpenAI.Chat.ChatCompletionTool[],
): Promise<boolean> {
    // ── Pass 0: hard per-message cap (ALL messages, including the tail) ─
    // A single tool result (e.g. a whole-file read) can exceed the entire
    // budget on its own and sit in the protected last-2 region where passes
    // 1–3 never reach it. Compacting its CONTENT (not removing the message)
    // is always safe — tool_call/tool pairing is preserved. Bounded by an
    // absolute ceiling so many messages can't sum past the model hard limit.
    const perMsgTokenCap = Math.min(
        Math.max(1500, Math.floor((Number.isFinite(tokenBudget) ? tokenBudget : 8000) * 0.5)),
        8000,
    );
    const perMsgCharCap = perMsgTokenCap * 3; // conservative ~3 chars/token
    for (let i = 1; i < messages.length; i++) {
        const m = asAgentMsg(messages[i]);
        if (typeof m.content === "string" && countTokens(m.content) > perMsgTokenCap) {
            m.content = compactExcerpt(
                m.content,
                Math.floor(perMsgCharCap * 0.6),
                Math.floor(perMsgCharCap * 0.4),
            );
        }
    }

    // ── Pass 1: compact string content in old messages ────────────────
    for (let i = 2; i < messages.length - 2; i++) {
        const m = asAgentMsg(messages[i]);
        if (typeof m.content === "string" && m.content.length > 300) {
            const compacted = compactExcerpt(m.content);
            if (compacted.length < m.content.length) m.content = compacted;
        }
    }

    // ── Pass 2: LLM distillation of old tool-call groups ─────────────
    if (countContextTokens(messages, tools) > tokenBudget && messages.length > 6) {
        const { groups, indices } = extractToolGroups(messages, 2, messages.length - 2);

        if (groups.length > 0) {
            let summary = "";
            try {
                emitLog(onProgress, `Distilling ${groups.length} research step(s) into factsheet…`);
                summary = await distillGroupsToSummary(
                    openai,
                    modelName,
                    callTimeoutMs,
                    groups,
                    logger,
                );
                logger.log(
                    `${phaseLabel} Distilled ${groups.length} groups → ${
                        countTokens(summary)
                    } tokens`,
                );
            } catch (err) {
                logger.error(
                    err,
                    `${phaseLabel} Distillation failed, dropping groups without summary`,
                );
            }

            // Remove old groups (reverse so earlier indices stay valid)
            for (const idx of indices.sort((a, b) => b - a)) messages.splice(idx, 1);

            // Insert the factsheet just after the initial system+user pair
            if (summary) {
                messages.splice(2, 0, {
                    role: "user",
                    content: `## Distilled Research Notes (from previous iterations)\n\n${summary}`,
                } as OpenAI.Chat.ChatCompletionMessageParam);
                emitLog(onProgress, `Factsheet inserted (${countTokens(summary)} tokens).`);
            }
        }
    }

    // ── Pass 3: truncate initial user/docs message as last resort ─────
    if (countContextTokens(messages, tools) > tokenBudget && messages.length > 1) {
        const userMsg = asAgentMsg(messages[1]);
        if (typeof userMsg.content === "string" && userMsg.content.length > 500) {
            const stub: OpenAI.Chat.ChatCompletionMessageParam = { role: "user", content: "" };
            const otherTokens = countContextTokens(
                [messages[0], stub, ...messages.slice(2)],
                tools,
            );
            const available = Math.max(500, (tokenBudget - otherTokens) * 3);
            userMsg.content = compactExcerpt(
                userMsg.content,
                Math.floor(available * 0.7),
                Math.floor(available * 0.3),
            );
        }
    }

    return countContextTokens(messages, tools) <= tokenBudget;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main loop
// ─────────────────────────────────────────────────────────────────────────────

function safeParse(json: string): unknown {
    try {
        return JSON.parse(json || "{}");
    } catch {
        return { _raw: json };
    }
}

interface StreamedCompletion {
    message: OpenAI.Chat.ChatCompletionMessageParam;
    usage?: OpenAI.Completions.CompletionUsage;
}

/**
 * Run one streaming chat completion, emitting each content delta as a `token`
 * event so clients can watch the model think in real time. Tool-call deltas are
 * accumulated across chunks and reassembled into a normal assistant message, so
 * the rest of the loop is unchanged.
 */
async function streamCompletion(
    openai: OpenAI,
    modelName: string,
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    tools: OpenAI.Chat.ChatCompletionTool[],
    config: AgenticLoopConfig,
    callTimeoutMs: number,
    onProgress: ProgressCallback,
): Promise<StreamedCompletion> {
    const stream = await openai.chat.completions.create(
        {
            model: modelName,
            messages,
            tools,
            tool_choice: "auto",
            stream: true,
            ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
            ...(config.seed !== undefined ? { seed: config.seed } : {}),
        },
        { signal: AbortSignal.timeout(callTimeoutMs) },
    );

    let content = "";
    const toolAcc: Array<{ id: string; name: string; args: string }> = [];
    let usage: OpenAI.Completions.CompletionUsage | undefined;

    for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (choice?.delta?.content) {
            content += choice.delta.content;
            emitToken(onProgress, choice.delta.content);
        }
        for (const tcd of choice?.delta?.tool_calls ?? []) {
            let i = tcd.index;
            if (i === undefined) {
                if (tcd.id) {
                    const existingIdx = toolAcc.findIndex((t) => t.id === tcd.id);
                    i = existingIdx >= 0 ? existingIdx : toolAcc.length;
                } else {
                    i = Math.max(0, toolAcc.length - 1);
                }
            }
            const acc = (toolAcc[i] ??= { id: "", name: "", args: "" });
            if (tcd.id) acc.id = tcd.id;
            if (tcd.function?.name) acc.name += tcd.function.name;
            if (tcd.function?.arguments) acc.args += tcd.function.arguments;
        }
        if (chunk.usage) usage = chunk.usage;
    }

    const tool_calls = toolAcc
        .filter(Boolean)
        .map((t) => ({
            id: t.id,
            type: "function" as const,
            function: { name: t.name, arguments: t.args },
        }));

    const message = {
        role: "assistant",
        content: content || null,
        ...(tool_calls.length ? { tool_calls } : {}),
    } as OpenAI.Chat.ChatCompletionMessageParam;

    return { message, usage };
}

export async function runAgenticLoop(
    openai: OpenAI,
    logger: Logger,
    onProgress: ProgressCallback,
    config: AgenticLoopConfig,
): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
    const {
        modelName,
        messages,
        tools,
        toolHandlers,
        readySignal,
        maxIterations,
        phaseLabel,
        onTrace,
    } = config;

    let iterations = 0;
    let isReady = false;

    const tokenBudget = config.maxContextTokens ??
        (config.maxContextChars ? Math.floor(config.maxContextChars / 4) : Infinity);
    const callTimeoutMs = config.callTimeoutMs ?? 90_000;

    while (iterations < maxIterations && !isReady) {
        logger.log(`${phaseLabel} Iteration ${iterations + 1}...`);
        emitPhase(onProgress, `${phaseLabel} · iteration ${iterations + 1}`);

        let contextTokens = countContextTokens(messages, tools);
        logger.log(`${phaseLabel} context: ~${contextTokens} tokens (${messages.length} messages)`);
        emitLog(onProgress, `Context size: ~${contextTokens} tokens (${messages.length} messages)`);

        if (contextTokens > tokenBudget) {
            logger.log(`${phaseLabel} Token budget exceeded — compacting context...`);
            emitLog(onProgress, `Token budget exceeded — compacting context...`);
            await pruneMessages(
                messages,
                tokenBudget,
                openai,
                modelName,
                callTimeoutMs,
                logger,
                phaseLabel,
                onProgress,
                tools,
            );
            contextTokens = countContextTokens(messages, tools);
            emitLog(onProgress, `Context after compaction: ~${contextTokens} tokens.`);
        }

        const { message, usage } = await withRetry(
            () =>
                streamCompletion(
                    openai,
                    modelName,
                    messages,
                    tools,
                    config,
                    callTimeoutMs,
                    onProgress,
                ),
            {
                retries: config.maxRetries ?? 3,
                baseDelayMs: config.retryBaseMs,
                label: `${phaseLabel} chat.completions`,
                logger,
            },
        );

        messages.push(message);

        if (onTrace) {
            await onTrace({
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                type: "LLM_CALL",
                content: { messages: messages.slice(0, -1), response: message, phase: phaseLabel },
                tokens: usage
                    ? {
                        promptTokens: usage.prompt_tokens,
                        completionTokens: usage.completion_tokens,
                        totalTokens: usage.total_tokens,
                    }
                    : undefined,
            });
        }

        const am = asAgentMsg(message);

        // Signal end-of-stream so clients collapse the live token view into a
        // tidy summary. The full content is included for that summary.
        if (am.content) {
            logger.log(`${phaseLabel} Agent Thoughts: ${am.content}`);
            emitAssistantEnd(onProgress, am.content);
        }

        if (am.tool_calls && am.tool_calls.length > 0) {
            // Execute all tool calls in the same turn concurrently — they are
            // independent (the model already decided what to call before seeing
            // any results). Order of tool_result messages must match tool_calls,
            // so we keep the original index to reinsert in the right position.
            const toolResults = await Promise.all(
                am.tool_calls.map(async (toolCall) => {
                    const handler = toolHandlers[toolCall.function.name];
                    const parsedArgs = safeParse(toolCall.function.arguments) as Record<
                        string,
                        unknown
                    >;
                    emitToolCall(onProgress, toolCall.function.name, parsedArgs);
                    let result: string;
                    if (handler) {
                        try {
                            const args = JSON.parse(toolCall.function.arguments || "{}") as Record<
                                string,
                                unknown
                            >;
                            result = await handler(toolCall.id, args);
                        } catch (err) {
                            result = `TOOL_ERROR: ${(err as Error)?.message ?? String(err)}`;
                            logger.error(
                                err,
                                `${phaseLabel} tool '${toolCall.function.name}' failed`,
                            );
                        }
                    } else {
                        result = `TOOL_ERROR: Unknown tool "${toolCall.function.name}"`;
                        logger.error(
                            null,
                            `${phaseLabel} unregistered tool '${toolCall.function.name}'`,
                        );
                    }
                    return { toolCall, result };
                }),
            );

            for (const { toolCall, result } of toolResults) {
                emitToolResult(onProgress, toolCall.function.name, result);
                messages.push({ role: "tool", tool_call_id: toolCall.id, content: result });

                if (onTrace) {
                    await onTrace({
                        id: crypto.randomUUID(),
                        timestamp: Date.now(),
                        type: "TOOL_CALL",
                        content: {
                            tool: toolCall.function.name,
                            args: safeParse(toolCall.function.arguments),
                            result,
                            phase: phaseLabel,
                        },
                    });
                }
            }
        } else if (am.content?.includes(readySignal) || am.content?.includes("NEEDS_RESEARCH:")) {
            isReady = true;
        }

        iterations++;
    }

    return messages;
}
