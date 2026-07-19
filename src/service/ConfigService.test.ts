/**
 * Unit tests for environment-driven configuration. Pure (reads Deno.env).
 * Run with: deno test --allow-env src/service/ConfigService.test.ts
 */
import { assertEquals } from "@std/assert";
import { ConfigService } from "./ConfigService.ts";
import { fakeLogger } from "../testing/fakes.ts";

/** Run `fn` with the given ROOKIE_* env vars set, restoring the prior state after. */
function withEnv(vars: Record<string, string>, fn: () => void) {
    // Snapshot and clear every ROOKIE_* var so the host environment can't leak in.
    const prior = new Map<string, string | undefined>();
    for (const key of Object.keys(Deno.env.toObject())) {
        if (key.startsWith("ROOKIE_")) {
            prior.set(key, Deno.env.get(key));
            Deno.env.delete(key);
        }
    }
    for (const [k, v] of Object.entries(vars)) {
        prior.set(k, prior.has(k) ? prior.get(k) : undefined);
        Deno.env.set(k, v);
    }
    try {
        fn();
    } finally {
        for (const [k, v] of prior) {
            if (v === undefined) Deno.env.delete(k);
            else Deno.env.set(k, v);
        }
    }
}

Deno.test("defaults apply when no env is set", () => {
    withEnv({}, () => {
        const c = new ConfigService(fakeLogger()).values;
        assertEquals(c.host, "localhost");
        assertEquals(c.port, 3000);
        assertEquals(c.mongoDb.dbName, "rookie_db");
        assertEquals(c.qdrantVectorDb.port, 6333);
        assertEquals(c.openAI.modelName, "gpt-4o-mini");
        assertEquals(c.embeddings.embeddingModel, "nomic-embed-text");
        assertEquals(c.reranker.mode, "llm");
        assertEquals(c.sandbox.hardening, true);
        assertEquals(c.sandbox.stepTimeoutMs, 60_000);
        assertEquals(c.sandbox.requireGroundedSuccess, true);
        assertEquals(c.planner.parallelGoals, 1);
    });
});

Deno.test("envNum parses numbers and falls back on garbage", () => {
    withEnv({ ROOKIE_PORT: "8080", ROOKIE_LLM_TEMPERATURE: "not-a-number" }, () => {
        const c = new ConfigService(fakeLogger()).values;
        assertEquals(c.port, 8080);
        assertEquals(c.llm.temperature, 0.2); // fallback
    });
});

Deno.test("envBool understands truthy/falsey spellings", () => {
    withEnv({ ROOKIE_SANDBOX_HARDENING: "false" }, () => {
        assertEquals(new ConfigService(fakeLogger()).values.sandbox.hardening, false);
    });
    withEnv({ ROOKIE_SANDBOX_HARDENING: "yes" }, () => {
        assertEquals(new ConfigService(fakeLogger()).values.sandbox.hardening, true);
    });
});

Deno.test("ROOKIE_OPENAI_KEY is preferred over the legacy typo ROOKIE_OPEAN_AI_KEY", () => {
    withEnv({ ROOKIE_OPENAI_KEY: "correct", ROOKIE_OPEAN_AI_KEY: "typo" }, () => {
        assertEquals(new ConfigService(fakeLogger()).values.openAI.apiKey, "correct");
    });
    withEnv({ ROOKIE_OPEAN_AI_KEY: "typo-only" }, () => {
        assertEquals(new ConfigService(fakeLogger()).values.openAI.apiKey, "typo-only");
    });
});

Deno.test("classifier votes and parallelGoals are clamped to >= 1", () => {
    withEnv({ ROOKIE_CLASSIFIER_VOTES: "0", ROOKIE_PARALLEL_GOALS: "-3" }, () => {
        const c = new ConfigService(fakeLogger()).values;
        assertEquals(c.classifier.votes, 1);
        assertEquals(c.planner.parallelGoals, 1);
    });
});

Deno.test("structuredOutputMode passes through", () => {
    withEnv({ ROOKIE_STRUCTURED_OUTPUT_MODE: "json_schema" }, () => {
        assertEquals(
            new ConfigService(fakeLogger()).values.llm.structuredOutputMode,
            "json_schema",
        );
    });
});
