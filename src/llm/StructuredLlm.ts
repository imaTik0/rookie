import OpenAI from "@openai/openai";
import { z } from "zod";
import { EMPTY_COMPLETION, withRetry } from "./retry.ts";

export type StructuredMode = "json_schema" | "json_object" | "text";

export interface StructuredLlmLogger {
    log: (...args: any[]) => void;
    error: (...args: any[]) => void;
}

export interface ChatStructuredOpts<T> {
    openai: OpenAI;
    model: string;
    system: string;
    user: string;
    schema: z.ZodType<T>;
    mode: StructuredMode;
    jsonSchema?: { name: string; schema: Record<string, unknown> };
    temperature?: number;
    seed?: number;
    maxRepairAttempts?: number;
    maxRetries?: number;
    retryBaseMs?: number;
    maxTokens?: number;
    maxTokensCap?: number;
    logger?: StructuredLlmLogger;
}

function deriveJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> | null {
    const toJSONSchema = (z as any).toJSONSchema;
    if (typeof toJSONSchema !== "function") return null;
    try {
        const js = toJSONSchema(schema, { target: "draft-2020-12" });
        return makeOpenAiStrict(js);
    } catch {
        try {
            return makeOpenAiStrict(toJSONSchema(schema));
        } catch {
            return null;
        }
    }
}

function makeOpenAiStrict(node: any): any {
    if (Array.isArray(node)) return node.map(makeOpenAiStrict);
    if (!node || typeof node !== "object") return node;

    for (const k of ["default", "$schema", "format", "minLength", "maxLength"]) {
        delete node[k];
    }
    if (node.type === "object" && node.properties && typeof node.properties === "object") {
        node.additionalProperties = false;
        for (const key of Object.keys(node.properties)) {
            node.properties[key] = makeOpenAiStrict(node.properties[key]);
        }
        node.required = Object.keys(node.properties);
    }
    if (node.items) node.items = makeOpenAiStrict(node.items);
    for (const comb of ["anyOf", "oneOf", "allOf"]) {
        if (Array.isArray(node[comb])) node[comb] = node[comb].map(makeOpenAiStrict);
    }
    return node;
}

export function extractJson(raw: string): string {
    const fenced = raw.match(/```json\s*([\s\S]*)```/i);
    const body = fenced ? fenced[1] : raw;
    const objStart = body.indexOf("{");
    const arrStart = body.indexOf("[");
    let start = -1;
    if (objStart === -1) start = arrStart;
    else if (arrStart === -1) start = objStart;
    else start = Math.min(objStart, arrStart);
    if (start === -1) return body.trim();
    const open = body[start];
    const close = open === "{" ? "}" : "]";
    const end = body.lastIndexOf(close);
    return end > start ? body.slice(start, end + 1) : body.slice(start);
}

export function coerceJson<T>(
    raw: string,
    schema: z.ZodType<T>,
): { ok: true; data: T } | { ok: false; error: string } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(extractJson(raw));
    } catch (e) {
        return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
    }
    const result = schema.safeParse(parsed);
    if (result.success) return { ok: true, data: result.data };
    return { ok: false, error: JSON.stringify(result.error.issues).slice(0, 800) };
}

function buildResponseFormat<T>(
    opts: ChatStructuredOpts<T>,
    effectiveMode: StructuredMode,
): Record<string, unknown> | undefined {
    if (effectiveMode === "json_object") return { type: "json_object" };
    if (effectiveMode === "json_schema") {
        const schema = opts.jsonSchema?.schema ?? deriveJsonSchema(opts.schema);
        if (schema) {
            return {
                type: "json_schema",
                json_schema: {
                    name: opts.jsonSchema?.name ?? "structured_output",
                    schema,
                    strict: true,
                },
            };
        }
        return { type: "json_object" };
    }
    return undefined;
}

function isSchemaError(err: unknown): boolean {
    const e = err as any;
    const status = e?.status ?? e?.response?.status;
    const msg = String(e?.message ?? e ?? "").toLowerCase();
    return status === 400 &&
        /response_format|json_schema|schema|strict|unsupported|invalid/.test(msg);
}

export async function chatStructured<T>(opts: ChatStructuredOpts<T>): Promise<T> {
    const maxRepairs = opts.maxRepairAttempts ?? 1;
    const retries = opts.maxRetries ?? 2;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
    ];

    let effectiveMode: StructuredMode = opts.mode;
    let tokenBudget = opts.maxTokens;
    const tokenCap = opts.maxTokensCap ?? 32_000;

    let lastError = "";
    for (let attempt = 0; attempt <= maxRepairs; attempt++) {
        const rf = buildResponseFormat(opts, effectiveMode);

        let content: string;
        try {
            content = await withRetry(
                async () => {
                    const resp = await opts.openai.chat.completions.create({
                        model: opts.model,
                        messages,
                        temperature: opts.temperature,
                        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
                        ...(tokenBudget ? { max_tokens: tokenBudget } : {}),
                        ...(rf ? { response_format: rf } : {}),
                    } as any);
                    const choice = (resp as any).choices?.[0];
                    const text: string = choice?.message?.content || "";
                    const truncated = choice?.finish_reason === "length";

                    if (!text.trim()) {
                        if (truncated && tokenBudget && tokenBudget < tokenCap) {
                            const next = Math.min(tokenBudget * 2, tokenCap);
                            opts.logger?.error(
                                `Empty completion with finish_reason=length — the token ` +
                                    `budget (${tokenBudget}) was consumed before any content. ` +
                                    `Raising to ${next} for the retry.`,
                            );
                            tokenBudget = next;
                        }
                        throw new Error(
                            `${EMPTY_COMPLETION} from model server ` +
                                `(finish_reason=${choice?.finish_reason ?? "unknown"})`,
                        );
                    }
                    if (truncated) {
                        if (tokenBudget && tokenBudget < tokenCap) {
                            tokenBudget = Math.min(tokenBudget * 2, tokenCap);
                        }
                        opts.logger?.error(
                            `Completion truncated (finish_reason=length); retrying with ` +
                                `a larger budget (${tokenBudget}).`,
                        );
                        throw new Error(`${EMPTY_COMPLETION} (truncated output)`);
                    }
                    return text;
                },
                {
                    retries,
                    baseDelayMs: opts.retryBaseMs,
                    label: `chat.completions(${effectiveMode})`,
                    logger: opts.logger,
                },
            );
        } catch (err) {
            if (effectiveMode === "json_schema" && isSchemaError(err)) {
                opts.logger?.error(
                    "Server rejected json_schema response_format; degrading to json_object.",
                );
                effectiveMode = "json_object";
                attempt--;
                continue;
            }
            throw err;
        }

        const result = coerceJson(content, opts.schema);
        if (result.ok) return result.data;

        lastError = result.error;
        opts.logger?.error(
            `Structured output validation failed (attempt ${attempt + 1}): ${lastError}`,
        );
        messages.push({ role: "assistant", content });
        messages.push({
            role: "user",
            content: `Your previous response did not match the required schema. ` +
                `Validation error: ${lastError}. ` +
                `Return ONLY corrected JSON that satisfies the schema. No prose, no code fences.`,
        });
    }

    throw new Error(`Structured output failed validation after repairs: ${lastError}`);
}
