# Rookie evaluation harness

Measures whether Rookie actually finds and correctly classifies documentation
gaps — the central claim of the project. Mirrors the labelled-benchmark approach
of the cited literature (RestBench, APISumBench, APIBench).

## What it measures

1. **Gap detection** (precision / recall / F1): of the injected defects, how many
   did the system flag, and how many of its flags were real?
2. **Gap classification** (macro-F1 + Cohen's κ): for detected defects, did it pick
   the right category (`MISSING` / `AMBIGUOUS` / `INCORRECT` / `CONFIG` /
   `ENVIRONMENT` / `UNKNOWN`)? κ compares against the human-assigned gold label.
3. **Goal pass rate**: fraction of generated scenarios that ran clean.

`ENVIRONMENT` failures are excluded from documentation-gap scoring on purpose —
they are tooling problems, not doc problems.

## Files

- `metrics.ts` — pure metric maths (confusion matrix, P/R/F1, Cohen's κ, voting).
- `metrics.test.ts` — unit tests, **no infrastructure needed**:
  `deno test src/eval/metrics.test.ts`
- `fixtures.ts` — documentation sets with known, injected defects (ground truth).
- `runEval.ts` — drives a running server over HTTP and prints the scores.

## Running

Unit tests (always runnable):

```bash
deno test src/eval/metrics.test.ts
```

Full integration evaluation (needs the stack up — Mongo, Qdrant, Docker, and an
LLM/embeddings backend; see the root README for a local small-model setup):

```bash
deno task start                 # in one terminal
deno run --allow-net --allow-env src/eval/runEval.ts
```

Override the target with `ROOKIE_EVAL_BASE_URL` (default `http://localhost:3000`).

Because results depend on the model, run it several times and/or across models
(e.g. GPT-4o-mini vs `qwen2.5-coder:7b` vs `gemma2:9b`) to compare.

## Suggested ablations

Toggle one variable at a time and re-run to justify design decisions:

| Variable                       | How                                                                    |
| ------------------------------ | ---------------------------------------------------------------------- |
| Hybrid vs dense-only retrieval | temporarily query only the dense vector                                |
| Reranker on/off                | `ROOKIE_RERANKER_MODE=off` vs `llm`                                    |
| Classifier votes               | `ROOKIE_CLASSIFIER_VOTES=1` vs `3` vs `5`                              |
| Dependency install on/off      | `ROOKIE_SANDBOX_AUTO_INSTALL_DEPS=false` (watch ENVIRONMENT rate rise) |
| Structured output mode         | `ROOKIE_STRUCTURED_OUTPUT_MODE=json_object` vs `text`                  |

## Extending the benchmark

Add entries to `FIXTURES` in `fixtures.ts`. Each defect needs an `expectedGap`
and `matchKeywords` (substrings expected to appear in the failure analysis — e.g.
the crashing function name). Prefer library fixtures with deterministic runtime
crashes so the ground truth is unambiguous.

## Mutation testing (thesis protocol)

> Szczegółowy opis techniczny systemu (operatory, protokół, korpusy,
> wymagania) znajduje się w [MUTATION.md](./MUTATION.md) (PL).

`mutation.ts` implements the four documentation-mutation operators
(`DelParam`→MISSING, `DelExmpl`→MISSING, `ObfuscateType`→AMBIGUOUS,
`AddFalseInfo`→INCORRECT) with seeded, reproducible first-order mutant
generation and ground-truth wound locations — unit-tested in `mutation.test.ts`
(no infrastructure needed).

`runMutation.ts` drives the full protocol against a running stack: a gold
baseline run (≥90% pass-rate check + false-alarm count) followed by one
`planner/rerun` per mutant (same goals, no regeneration), scored as MDS per
operator plus classification confusion/κ over detected mutants. Results are
written to `mutation-<ts>.json`.

```bash
deno task eval:mutation -- --dry-run            # inspect the mutant set (no infra)
deno task eval:mutation                          # full run (stack + LLM required)
deno task eval:mutation -- --seed 42 --per-operator 2 --fixture <name>
```
