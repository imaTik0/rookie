/**
 * One place that turns a chat prompt into a validated, typed object.
 *
 * - Requests JSON in the configured way:
 *     "json_schema"  → strict schema (OpenAI / newer servers; most reliable)
 *     "json_object"  → loose JSON mode (broadly supported, incl. Ollama/llama.cpp) [default]
 *     "text"         → no response_format; rely on the prompt (oldest/smallest models)
 * - Parses (tolerating code fences / surrounding prose) and validates with zod.
 * - On validation failure, asks the model to fix its JSON, up to `maxRepairAttempts`.
 *
 * This makes structured outputs robust on small local models, where strict
 * schema enforcement is often unavailable.
 */
import OpenAI from "@openai/openai";
import { z } from "zod";
import { withRetry } from "./retry.ts";

export type StructuredMode = "json_schema" | "json_object" | "text";

export interface StructuredLlmLogger {
    // Variadic to match the project Logger (pino-style) without coupling to it.
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
    /** Required only for "json_schema" mode. */
    jsonSchema?: { name: string; schema: Record<string, unknown> };
    temperature?: number;
    seed?: number;
    maxRepairAttempts?: number;
    /** Transient-error retries (per model call). */
    maxRetries?: number;
    retryBaseMs?: number;
    logger?: StructuredLlmLogger;
}

/**
 * Best-effort derivation of an OpenAI-strict JSON Schema from a zod schema
 * (zod v4 `z.toJSONSchema`). Returns null if unavailable/unsupported — callers
 * then fall back to json_object mode. If the server rejects the schema at call
 * time, chatStructured downgrades automatically too, so this never hard-fails.
 */
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

/** Recursively coerce a JSON Schema toward OpenAI's strict subset. */
function makeOpenAiStrict(node: any): any {
    if (Array.isArray(node)) return node.map(makeOpenAiStrict);
    if (!node || typeof node !== "object") return node;

    // Strip keywords OpenAI strict mode disallows / ignores.
    for (const k of ["default", "$schema", "format", "minLength", "maxLength"]) {
        delete node[k];
    }
    if (node.type === "object" && node.properties && typeof node.properties === "object") {
        node.additionalProperties = false;
        for (const key of Object.keys(node.properties)) {
            node.properties[key] = makeOpenAiStrict(node.properties[key]);
        }
        // Strict requires every property to be listed as required.
        node.required = Object.keys(node.properties);
    }
    if (node.items) node.items = makeOpenAiStrict(node.items);
    for (const comb of ["anyOf", "oneOf", "allOf"]) {
        if (Array.isArray(node[comb])) node[comb] = node[comb].map(makeOpenAiStrict);
    }
    return node;
}

/** Strip ```json fences / surrounding prose and isolate the JSON payload. */
export function extractJson(raw: string): string {
    // Only unwrap an *explicitly* json-labelled fence. A bare ``` fence must NOT
    // be stripped: the JSON payload's own string values may embed ```yaml / ```js
    // blocks, and grabbing the first bare fence would capture that inner block
    // instead of the JSON (e.g. a YAML readiness-probe snippet in a summary field).
    // Greedy to the *last* ``` so a nested ```yaml/```js block inside a value
    // doesn't prematurely close the capture; the brace-finder below then isolates
    // the actual JSON object/array from whatever remains.
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

/** Parse + zod-validate. Returns a discriminated result; never throws. */
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
        // Prefer an explicitly supplied schema, otherwise derive from zod.
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
        // Could not produce a schema → degrade to loose JSON mode.
        return { type: "json_object" };
    }
    // "text" → no response_format
    return undefined;
}

/** Heuristic: does this error look like the server rejecting our response_format? */
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

    // Mode can degrade at runtime if the server rejects json_schema.
    let effectiveMode: StructuredMode = opts.mode;

    let lastError = "";
    for (let attempt = 0; attempt <= maxRepairs; attempt++) {
        const rf = buildResponseFormat(opts, effectiveMode);

        let content: string;
        try {
            const resp = await withRetry(
                () =>
                    opts.openai.chat.completions.create({
                        model: opts.model,
                        messages,
                        temperature: opts.temperature,
                        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
                        ...(rf ? { response_format: rf } : {}),
                    } as any),
                {
                    retries,
                    baseDelayMs: opts.retryBaseMs,
                    label: `chat.completions(${effectiveMode})`,
                    logger: opts.logger,
                },
            );
            content = (resp as any).choices[0]?.message?.content || "";
        } catch (err) {
            // If the server rejected the JSON schema, drop to json_object and retry
            // this attempt without consuming a repair slot.
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
        // Feed the bad output + error back for a repair attempt.
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
