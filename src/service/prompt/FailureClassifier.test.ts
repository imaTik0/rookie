import { assertEquals } from "@std/assert";
import { FailureClassifier } from "./FailureClassifier.ts";
import { ConfigService } from "../ConfigService.ts";
import { apiError, fakeLogger, fakeOpenAI } from "../../testing/fakes.ts";
import type OpenAI from "@openai/openai";

function classifier(openai: OpenAI, config?: ConfigService) {
    return new FailureClassifier(openai, config ?? new ConfigService(fakeLogger()), fakeLogger());
}

Deno.test("classify: majority vote sets gap, votes and confidence", async () => {
    const { openai } = fakeOpenAI([{
        content: JSON.stringify({ documentationGap: "INCORRECT", failedFunction: "f" }),
    }]);
    const a = await classifier(openai).classify("err", "code", "docs", "desc");
    assertEquals(a.documentationGap, "INCORRECT");
    assertEquals(a.votes, 3);
    assertEquals(a.confidence, 1);
});

Deno.test("classify: fragmentScorer breaks ties toward the best-verifying quote", async () => {
    const frags = ["bad one", "the good verbatim quote", "bad two"];
    const { openai } = fakeOpenAI((i) => ({
        content: JSON.stringify({
            documentationGap: "MISSING",
            pinpointedFragment: frags[i] ?? frags[0],
        }),
    }));
    const a = await classifier(openai).classify("err", "code", "docs", "desc", {
        fragmentScorer: (f) => (f === "the good verbatim quote" ? 1 : 0),
    });
    assertEquals(a.documentationGap, "MISSING");
    assertEquals(a.pinpointedFragment, "the good verbatim quote");
});

Deno.test("classify: all votes failing yields the UNKNOWN fallback", async () => {
    const { openai } = fakeOpenAI([{ error: new Error("model down") }]);
    const a = await classifier(openai).classify("the error", "code", "docs", "desc");
    assertEquals(a.documentationGap, "UNKNOWN");
    assertEquals(a.votes, 0);
    assertEquals(a.confidence, 0);
});

Deno.test("refineSearchQuery returns the trimmed model output", async () => {
    const { openai } = fakeOpenAI([{ content: "  refined query  " }]);
    assertEquals(await classifier(openai).refineSearchQuery("err", "ctx"), "refined query");
});

Deno.test("refineSearchQuery falls back to error+context on failure", async () => {
    const { openai } = fakeOpenAI([{ error: apiError(500, "boom") }]);
    assertEquals(await classifier(openai).refineSearchQuery("E", "C"), "E C");
});
