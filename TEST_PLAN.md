# Rookie Backend — Test Plan

> **Goal:** take the backend from 3 test files (2 of which CI would run) to a well-tested,
> regression-safe codebase, **without** changing the testing conventions you already use.
> This plan is phased by ROI and risk — Phase 1 alone covers the characterization tests the
> [refactor audit](REFACTOR_AUDIT.md) (§6) said must exist before the structural refactors.

## Conventions (keep as-is)

- **Runner:** Deno's built-in `Deno.test()`. **Assertions:** `jsr:@std/assert`. Grouped
  subtests via `t.step(...)`. This is what `feedback.test.ts`, `metrics.test.ts`, and
  `DockerExecutor.test.ts` already do — no new framework.
- **Fixtures:** inline string fixtures + small factory helpers (the `makeFinding()` pattern in
  `feedback.test.ts`). Keep this; promote shared builders into `src/testing/` (Phase 0).
- **Co-locate** `*.test.ts` next to the code under test (`feedback/`, `eval/` already do).
  `src/tests/DockerExecutor.test.ts` is the lone exception — move it next to its source in
  Phase 0 so discovery globs find everything.

## Two pre-existing issues to fix first

1. **`deno task test` only runs two files** (`metrics.test.ts feedback.test.ts`). New test
   files won't run unless added. Switch to glob discovery (see Phase 0) so every `*.test.ts`
   runs automatically.
2. **`DockerExecutor.test.ts` skips via top-level `Deno.exit(0)`** when Docker is absent
   ([`src/tests/DockerExecutor.test.ts:11,15`](src/tests/DockerExecutor.test.ts)). `Deno.exit`
   kills the **entire** test process — in a combined run it would abort sibling test files.
   Replace with the per-test ignore flag: `Deno.test({ name, ignore: !hasDocker }, ...)`.
   Adopt this same `ignore` pattern for all infra-gated tests (Phase 3).

---

## Test tiers & infra strategy

| Tier                         | What                                                       | Infra             | Runs in CI                                      |
| ---------------------------- | ---------------------------------------------------------- | ----------------- | ----------------------------------------------- |
| **1 — Unit (pure)**          | Deterministic functions, no I/O                            | none              | always, on every push                           |
| **2 — Service (faked deps)** | Orchestration logic with test doubles for Mongo/LLM/Docker | none              | always                                          |
| **3 — Integration (gated)**  | Real Mongo / Qdrant / Docker via repos & managers          | docker-compose    | nightly / on-demand, `ignore` when absent       |
| **4 — E2E / eval**           | Full stack over HTTP                                       | whole stack + LLM | manual / nightly (already exists: `runEval.ts`) |

**Seams that make this cheap:** the codebase is already DI-friendly. Services take
dependencies via constructor, and the IoC's `create(name, props)` / `createEx(clazz, props)`
let you inject fakes by name. `registerController(app, instance, logger)` is exported, so a
controller can be mounted on a throwaway `OpenAPIHono` and driven with `app.request(...)` —
no server, no network. **Decision needed:** Mongo integration strategy — `mongodb-memory-server`
(npm, in-process) vs a docker-compose `mongo`+`qdrant` pair with `ignore`-skip. Recommend
docker-compose for fidelity (Qdrant has no in-memory mock anyway), with `ignore` so local runs
without it stay green.

---

## Phase 0 — Tooling & scaffolding (½ day, do first)

1. **Test tasks in `deno.json`:**
   ```jsonc
   "test":       "deno test --allow-all",                 // discovers every *.test.ts
   "test:unit":  "deno test --allow-read --allow-env src/", // tiers 1–2, no infra
   "test:cov":   "deno test --allow-all --coverage=coverage && deno coverage coverage",
   "test:watch": "deno test --allow-all --watch"
   ```
2. **`src/testing/` support module** (shared doubles + builders):
   - `fakeLogger()` — no-op `Logger`.
   - `fakeOpenAI(scripted)` — minimal object with `chat.completions.create` returning queued
     responses (and able to throw a 429/400 to exercise retry/schema-degrade paths).
   - `InMemoryRepo<T>` base + per-entity in-memory repos satisfying the repository surfaces
     used by services (`get`, `create`, `listSlim`, …).
   - `fakeDockerExecutor(scripted)` — returns canned `{ exitCode, stdout, stderr, isTimeout }`.
   - Fixture builders: `makeFinding` (lift from `feedback.test.ts`), `makeDocFile`,
     `makeStepResult`, `makeReport`.
3. **CI:** add `.github/workflows/test.yml` (no CI exists today) running `deno fmt --check`,
   `deno lint`, and `deno task test:unit` on push/PR. A separate nightly job with a
   `services:` block (mongo, qdrant) + Docker for Tier 3/4.
4. **Coverage baseline:** run `test:cov` once, record the starting number in this file.

---

## Phase 1 — Pure-logic unit tests (highest ROI, ~2–3 days)

No infrastructure. This phase delivers the bulk of the safety net and satisfies audit §6.
Target **≥90 %** line coverage on each module below.

| Source                                                                    | New test file                         | Key cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`rag/Bm25.ts`](src/rag/Bm25.ts)                                          | `rag/Bm25.test.ts`                    | `tokenId` deterministic & in u32 range; `tokenize` lowercases/splits/drops stopwords & len≤1; `encodeDocument` TF-saturation math vs hand-computed weight, doc-length norm with k1/b; `encodeQuery` presence-only (all values = 1); same token → same index across docs                                                                                                                                                                                                                          |
| [`sandbox/depDetect.ts`](src/sandbox/depDetect.ts)                        | `sandbox/depDetect.test.ts`           | `parseImportedPackages` for all 4 patterns (static/side-effect/dynamic/require), scoped `@scope/pkg`, sub-paths reduced to package, dedupe; excludes relative/`node:`/builtins; `isEnvironmentError` matches each signature & rejects doc-gap errors                                                                                                                                                                                                                                             |
| [`llm/StructuredLlm.ts`](src/llm/StructuredLlm.ts)                        | `llm/StructuredLlm.test.ts`           | `extractJson` (`` ```json ``-fenced, prose-wrapped, array root, nested braces, none→trim); `coerceJson` (valid, bad JSON, zod-fail message); `makeOpenAiStrict` (`additionalProperties:false`, all props required, strips default/format/$schema, recurses items/anyOf); `isSchemaError`; `buildResponseFormat` per mode + derive-fail→json_object; **`chatStructured` with `fakeOpenAI`:** happy path, repair loop on zod-fail, json_schema→json_object degrade on 400, throw after max repairs |
| [`llm/retry.ts`](src/llm/retry.ts)                                        | `llm/retry.test.ts`                   | `isRetryableError` (429/408/5xx + each network substring; non-retryable 400/404 → false); `withRetry` succeeds-first-try, retries then succeeds, exhausts then throws, re-throws non-retryable immediately (inject a fast/stubbed sleep to keep tests instant)                                                                                                                                                                                                                                   |
| [`llm/tokens.ts`](src/llm/tokens.ts)                                      | `llm/tokens.test.ts`                  | `countTokens` non-zero for text, 0 for empty; `countMessageTokens` adds framing + serialized tool_calls; heuristic fallback path                                                                                                                                                                                                                                                                                                                                                                 |
| [`service/FileHelpers.ts`](src/service/FileHelpers.ts)                    | `service/FileHelpers.test.ts`         | `chunkDbFile`: size-based split honors chunkSize/overlap; **never splits inside a fenced code block**; heading-boundary awareness; OpenAPI JSON detected → endpoint-level chunks (one per path+method); YAML MIME indexed not skipped; tiny file → single chunk                                                                                                                                                                                                                                  |
| [`feedback/docExamples.ts`](src/feedback/docExamples.ts)                  | `feedback/docExamples.test.ts`        | extracts `js/ts/javascript/typescript` fences only; captures nearest heading + preceding prose + 1-based line; `docExampleLabel` formatting; ignores non-code fences                                                                                                                                                                                                                                                                                                                             |
| [`service/ConfigService.ts`](src/service/ConfigService.ts)                | `service/ConfigService.test.ts`       | defaults when env unset; `envBool`/`envNum` parsing & bad-value fallback; **`ROOKIE_OPENAI_KEY` preferred over typo `ROOKIE_OPEAN_AI_KEY`**; `structuredOutputMode` passthrough; `classifier.votes`/`parallelGoals` clamped to ≥1 (save/restore `Deno.env` around each test)                                                                                                                                                                                                                     |
| [`Utils.ts`](src/Utils.ts)                                                | `Utils.test.ts`                       | `sha256` known vector; `tryPromise` success & error shapes                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [`ioc/IOC.ts`](src/ioc/IOC.ts)                                            | `ioc/IOC.test.ts`                     | `ReflectUtils.getClassConstructorParametersNames` (params, no-ctor base-class recursion, comment stripping); `registerValue`/`registerFactory`/`register` (name-lowercasing); `resolve` wires constructor deps by name; singleton caching; duplicate-name throws; missing-name throws; `create(name, props)` overrides. _(Locks current behavior before any audit §3.4 rewrite.)_                                                                                                                |
| [`service/Executor.ts`](src/service/Executor.ts) (pure parts)             | `service/Executor.pure.test.ts`       | `overallStatus` (all-pass→SUCCESS, all-fail→FAILED, mixed→PARTIAL); `parseInitialContext` (valid JSON, garbage→fallback); **`classifyEnvironmentError` CONFIG-vs-ENVIRONMENT ±5-line keyword logic** (module+no-install→CONFIG, module+install→CONFIG variant, not-mentioned→ENVIRONMENT) — audit §6.2                                                                                                                                                                                           |
| [`service/PlannerService.ts`](src/service/PlannerService.ts) (pure parts) | `service/PlannerService.pure.test.ts` | **`gapsSimilar`** (same-file overlapping lines, fragment Jaccard ≥0.5, failed-fn+category match, non-match) — audit §6.4; `extractEndpointInventory` (OpenAPI paths→`METHOD /path`, markdown HTTP-verb headings, 100-cap)                                                                                                                                                                                                                                                                        |
| [`api/Decorator.ts`](src/api/Decorator.ts)                                | `api/Decorator.test.ts`               | `@Get/@Post/...` accumulate route metadata; `registerController` mounts every route on a fake `OpenAPIHono` and logs the count _(would have caught the dead-`_method` smell)_                                                                                                                                                                                                                                                                                                                    |

> Some pure logic (`formatSearchResults`, `cleanHistoryForReport`,
> `extractGapAnalysisFromBounce`, `buildOpenApiIndex`, VFS tool handlers) currently lives
> **inside** the 1,339-line `PromptService`. Extracting it (audit §3.1) makes it directly
> testable; until then, test it through the public methods in Phase 2.

---

## Phase 2 — Service orchestration with fakes (~3–4 days)

No infra — inject the `src/testing/` doubles. Verifies the wiring/branching logic.

| Target                                                 | Test file                        | Key cases                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Controllers** (all)                                  | `api/<x>/<X>Controller.test.ts`  | Mount controller on a fresh `OpenAPIHono` via `registerController`, drive with `app.request()`. Assert status + body for success, 404 (not-found), 400 (validation/service error). **Add a test asserting `TraceController`'s routes resolve** — directly covers audit §1.1 (dead routes). Confirms the duplicated catch behavior before audit §2.1 centralizes it. |
| [`Executor`](src/service/Executor.ts) orchestration    | `service/Executor.test.ts`       | `executeCodeGeneration` happy path with fake `PromptService`+`DockerExecutor`+repos; failed step → `analyzeStepFailure` → classification stored; abort signal → `JobCancelledError`; **HTTP-log marker parsing** (`___HTTP_LOG_START___…___END___`) from canned stdout → `StepResult.httpTrafficLog` — audit §6.1                                                   |
| [`PlannerService`](src/service/PlannerService.ts)      | `service/PlannerService.test.ts` | `runMasterPlan` end-to-end with fakes: progress events emitted in order; deterministic overrides applied (passRate, taxonomy); `rerunMasterPlan` reuses goals & uses original gaps as baseline; `computeRegressionStatus` NEW vs PERSISTED; batched concurrency respects `parallelGoals`                                                                            |
| [`JobService`](src/service/JobService.ts)              | `service/JobService.test.ts`     | enqueue→run→SUCCEEDED/FAILED transitions; `reconcileOnStartup` fails orphaned RUNNING jobs; cancellation                                                                                                                                                                                                                                                            |
| [`PromptService`](src/service/PromptService.ts) phases | `service/PromptService.test.ts`  | With `fakeOpenAI`: `promptForUserGoals` parses goal list; agentic loop honors `NEEDS_RESEARCH:` bounce; `rerankSearchResults` `off` mode passthrough; `classifyFailure` self-consistency majority vote across `votes`                                                                                                                                               |
| [`HtmlToMarkdown`](src/service/HtmlToMarkdown.ts)      | `service/HtmlToMarkdown.test.ts` | Readability extracts main content (strips nav/footer); Turndown preserves tables & code fences; **SPA detection** (short body + `#swagger-ui`/`#app` root → skipped); readability fallback under `readabilityMinChars` _(linkedom is in-process, so this needs no network)_                                                                                         |

---

## Phase 3 — Infrastructure integration (gated, ~2–3 days)

Real backing services via docker-compose; each test `ignore`s when its dependency is absent
(reuse the Docker-availability probe pattern, fixed per the Phase-0 note).

| Target                                                              | Test file                                | Infra  | Key cases                                                                                                                                                                        |
| ------------------------------------------------------------------- | ---------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repositories (`Project/File/Job/Report/TestSuite/Trace`)            | `db/mongo/*.repo.test.ts`                | Mongo  | CRUD round-trips, `getPopulated` joins, pagination `listSlim`/`listPopulated`, `removeFileFromAllProjects`, id generation. Spin up a throwaway DB name per run; drop in teardown |
| [`MigrationManager`](src/db/mongo/MigrationManager.ts)              | `db/mongo/MigrationManager.test.ts`      | Mongo  | `runAllMigrations` idempotent; 001 scheme + 002 indices applied; re-run is a no-op                                                                                               |
| [`VectorCollection`](src/db/vectordb/VectorCollection.ts) + factory | `db/vectordb/VectorCollection.test.ts`   | Qdrant | create collection (named-vector + sparse IDF modifier), upsert chunks, hybrid query returns RRF-fused order, delete-by-file, drop collection                                     |
| [`DockerExecutor`](src/service/DockerExecutor.ts)                   | move to `service/DockerExecutor.test.ts` | Docker | **keep existing cases**; add a unit test for the pure `buildArgs` (hardening/user/pids/network flags) that needs no Docker; convert skip to `ignore`                             |

---

## Phase 4 — E2E & continuous evaluation (~1 day)

- **Smoke E2E:** boot the app wired to fake/in-memory infra, `app.request()` a happy-path
  slice (create project → list → 404 on missing). Catches wiring/registration regressions
  (the TraceController class of bug) in one fast test.
- **Eval in CI:** `runEval.ts` already measures detection/classification F1 + Cohen's κ over
  labelled fixtures. Add a nightly CI job (full stack + small local model, or a recorded-LLM
  fixture mode) that fails if recall/F1 drops below a threshold — turning your thesis metric
  into a regression gate.

---

## Coverage targets

| Area                                                                                               | Target                                                             |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Phase 1 pure modules                                                                               | ≥ 90 % lines                                                       |
| Critical paths (Executor classify, PlannerService regression, IoC, StructuredLlm, Bm25, depDetect) | ~100 %                                                             |
| Overall (excluding infra adapters)                                                                 | 75–85 %                                                            |
| Infra adapters (Mongo/Qdrant/Docker managers)                                                      | covered by Tier 3 when infra present; not counted in the unit gate |

Measure with `deno task test:cov`; enforce the unit-tier floor in CI.

---

## Suggested execution order

1. **Phase 0** (tooling) — unblocks everything; fixes the `Deno.exit` skip footgun and the
   2-file task.
2. **Phase 1** (pure units) — biggest safety-per-hour; _this is the prerequisite the refactor
   audit asked for_, so do it before any P2 refactor there.
3. **Phase 2** (faked services) — covers orchestration + the controller/Trace registration bug.
4. **Phase 3 / 4** — infra + eval gating, as a separate hardening pass.

**Recommended starting point:** Phase 0 + the first five rows of Phase 1
(`Bm25`, `depDetect`, `StructuredLlm`, `retry`, `Executor.classifyEnvironmentError`). That's
~1.5 days, needs no infra, and locks down the highest-value logic immediately.

---

_This is a plan only — no test files have been created yet. Tell me which phase (or which
specific rows) to implement and I'll write them following the conventions above._
