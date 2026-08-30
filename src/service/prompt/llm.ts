import type OpenAI from "@openai/openai";
import type { z } from "zod";
import type { ConfigService } from "../ConfigService.ts";
import type { Logger } from "../../Logger.ts";
import { chatStructured } from "../../llm/StructuredLlm.ts";

export function llmParams(configService: ConfigService): Record<string, unknown> {
    const llm = configService.values.llm;
    return {
        temperature: llm.temperature,
        ...(llm.seed !== undefined ? { seed: llm.seed } : {}),
    };
}

export function loopParams(configService: ConfigService): Record<string, unknown> {
    const llm = configService.values.llm;
    return {
        temperature: llm.temperature,
        ...(llm.seed !== undefined ? { seed: llm.seed } : {}),
        maxRetries: llm.maxRetries,
        retryBaseMs: llm.retryBaseMs,
        callTimeoutMs: llm.callTimeoutMs,
        maxContextTokens: configService.values.limits.maxContextTokens,
    };
}

export type StructuredFn = <T>(system: string, user: string, schema: z.ZodType<T>) => Promise<T>;

export function makeStructured(
    openai: OpenAI,
    configService: ConfigService,
    logger: Logger,
): StructuredFn {
    return <T>(system: string, user: string, schema: z.ZodType<T>): Promise<T> => {
        const llm = configService.values.llm;
        return chatStructured<T>({
            openai,
            model: configService.values.openAI.modelName,
            system,
            user,
            schema,
            mode: llm.structuredOutputMode,
            temperature: llm.temperature,
            seed: llm.seed,
            maxRepairAttempts: llm.maxRepairAttempts,
            maxRetries: llm.maxRetries,
            retryBaseMs: llm.retryBaseMs,
            maxTokens: llm.maxTokens,
            logger,
        });
    };
}
