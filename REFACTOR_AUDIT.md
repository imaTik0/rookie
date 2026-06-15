# Rookie Backend — Refactor Audit

> **Update — implementation status (after the test suite landed):**
>
> | Item | Status |
> | --- | --- |
> | §1.1 TraceController dead routes | ✅ Fixed — now mounted via the shared `registerControllers` helper ([src/api/registerControllers.ts](src/api/registerControllers.ts)); guarded by [smoke.test.ts](src/api/smoke.test.ts) |
> | §1.2 Dead `_method` destructure | ✅ Removed |
> | §2.4 Unused `@hono/swagger-ui` dep | ✅ Dropped from deno.json |
> | §2.5 Inverted `isManualRegistrationSet` | ✅ Renamed → `shouldAutoRegister` / `@ExcludeFromScan` |
> | §3.2 Extract Executor Docker harness | ✅ Done — [src/sandbox/harness.ts](src/sandbox/harness.ts), verified e2e by [harness.test.ts](src/sandbox/harness.test.ts) |
> | §2.3 Type holes (`as any`) | ◐ Partial — fixed the **7 pre-existing type errors** that blocked `deno check` (the app did not type-check before); broader `as any` trimming deferred |
> | **New** — 7 pre-existing `deno check` errors | ✅ Fixed (tc.function union, GoalBreakdown branding, Report.conversationHistory, /reports RouteHandler) |
> | **New** — Scanner bugs found by the smoke test | ✅ Fixed — imported `.test.ts` files at startup; un-awaited subdirectory recursion (controller-registration race) |
> | **New** — `fragmentVerify` short-fragment dilution | ✅ Fixed + regression tests |
> | §2.1 Centralize controller error handling | ⏳ Deferred (behaviour-neutral; touches 6 controllers + tests) |
> | §2.2 `console.*` → injected `Logger` | ⏳ Deferred (low-risk, mostly cosmetic) |
> | §3.1 Split `PromptService` god-class | ⏳ Deferred — highest risk; needs dedicated PromptService characterization tests first |
> | §3.3 Consolidate repositories into one folder | ⏳ Deferred (touches IoC registration) |
> | §3.4 Replace regex-based IoC param parser | ⏳ Deferred (high risk; works today) |
> | CI pipelines | ⏭️ Skipped per request |
>
> Original audit text below is preserved for reference.

> **Status:** audit only — _no source code has been changed._ This document is a
> prioritized menu of issues and proposed refactors. Pick what you want applied and
> I'll implement those items. The only file edited alongside this audit is
> `README.md` (you asked for its inaccuracies fixed — see [§7](#7-readme-corrections-applied)).

**Scope reviewed:** `src/` (~13.4k LOC), `deno.json`, `.env`, `.gitignore`, route/controller
wiring, the IoC container, the LLM layer, the planner/executor pipeline, and the
Mongo data-access layer.

**Headline:** this is a genuinely capable codebase, not a typical "rookie" one. The LLM
layer (`StructuredLlm`, `retry`), `PlannerService`, the repositories, and the route
definitions are already well-factored, well-commented, and defensively written. The
Docker sandbox builds its command with an args array (`Deno.Command("docker", {args})`),
so there is **no shell-injection surface**. The issues below are real but mostly
localized — there is no rewrite warranted.

The single most important caveat: **test coverage is thin** (only
`src/eval/metrics.test.ts` and `src/feedback/feedback.test.ts`). The orchestration core
— `Executor`, `PlannerService`, the IoC, the controllers — is untested. That makes the
deeper refactors (P2) riskier than they look. My recommendation is to do **P0 + P1**
now (low risk), and gate **P2** behind characterization tests ([§6](#6-test-coverage-the-gate-for-deeper-work)).

Priorities: **P0** = correctness bug, fix now · **P1** = consistency/maintainability,
low risk · **P2** = structural, higher effort/risk · **P3** = housekeeping.

---

## 1. P0 — Correctness bugs (small, safe)

### 1.1 `TraceController` is never registered → `/traces/*` routes are dead (404)

- **Where:** [`src/App.ts:32-61`](src/App.ts) registers six controllers
  (Project, File, Report, TestSuite, Planner, Job). `TraceController` is **not** among them.
- **Symptom:** `GET /traces/{traceId}` and `GET /testsuites/{testSuiteId}/traces`
  (defined in [`src/api/trace/TraceRoute.ts`](src/api/trace/TraceRoute.ts) and implemented in
  [`src/api/trace/TraceController.ts`](src/api/trace/TraceController.ts)) are never mounted on the
  Hono app, so they return 404. The controller instance _is_ constructable via the IoC
  (it's exported and auto-scanned), it's simply never wired into the server.
- **Impact:** currently low — the frontend's API client doesn't call these endpoints yet —
  but it's a latent bug and the routes silently don't exist.
- **Proposed fix:** add one `registerController(... resolve<TraceController>("traceController") ...)`
  block in `App.init()`. ~3 lines. No behavior risk for other routes.
- **Decision needed:** keep traces and wire them up, **or** delete `TraceController`/`TraceRoute`/`TraceRepository`
  if traces are abandoned. (Note `TraceRepository` _is_ explicitly registered in
  [`src/Container.ts:32`](src/Container.ts), so the data layer is alive — suggests "wire it up".)

### 1.2 Dead / misnamed destructure in `registerController`

- **Where:** [`src/api/Decorator.ts:60`](src/api/Decorator.ts)
  ```ts
  for (const { _method, route, handlerName } of routes) {
  ```
  The route records are pushed as `{ method, route, handlerName }` (no underscore), so
  `_method` is **always `undefined`**. It happens to be harmless because the HTTP method
  is already baked into the `route` config by `createRoute`, so `app.openapi(route, handler)`
  doesn't need it — but the binding is dead and misleading.
- **Proposed fix:** drop `_method` from the destructure (one line). Zero behavior change.

---

## 2. P1 — Consistency & maintainability (low risk)

### 2.1 Duplicated controller error handling (7×)

- **Where:** `ProjectController`, `TestSuiteController`, etc. — 7 copies of:
  ```ts
  } catch (error) {
      const err = error as { message?: string };
      return c.json({ code: 400, message: err?.message || "Unknown error" }, 400);
  }
  ```
- **Proposed fix:** centralize via a Hono `app.onError(...)` handler (throw typed
  `HttpError`s from services) **or** a small `wrapHandler()` helper. Removes the repetition
  and makes status codes consistent. Also lets you drop the `500 as any` casts (see §2.3).
- **Effort:** ~1 hr. **Risk:** low (touches error paths only; easy to verify).

### 2.2 `console.*` bypasses the injected `Logger` (45 call-sites)

- **Where:** non-test `console.log/warn/error` in `Executor.ts`, `FileHelpers.ts`,
  `VectorCollection.ts`, `Scanner.ts`, `DocCrawler.ts`, etc. A proper `Logger` (pino,
  with truncation) exists and is already injected almost everywhere.
- **Proposed fix:** route these through the injected `Logger` so logs are structured and
  consistently formatted/truncated. Bootstrap logging in [`src/init.ts`](src/init.ts) using
  `console.log` is fine to keep (no container yet).
- **Effort:** ~1 hr, mechanical. **Risk:** low.

### 2.3 `as any` casts (30) hide type holes

- **Where (worst):** controllers (`c.json({...}, 500 as any)`), [`TraceController`](src/api/trace/TraceController.ts)
  (every response is `as any`), [`PlannerService.ts:374`](src/service/PlannerService.ts)
  (`reportRepository.create({...} as any)`), and the LLM layer's `(resp as any)`.
- **Proposed fix:** tighten incrementally — use Hono's status-code unions instead of
  `500 as any`; give `TraceController` proper response schemas; type the report-create
  payload. Some `as any` in the LLM layer are pragmatic (SDK shape mismatches) and can stay
  with a comment.
- **Effort:** incremental. **Risk:** low — compiler-guided.

### 2.4 `@hono/swagger-ui` is a declared-but-unused dependency

- **Where:** [`deno.json:21`](deno.json) imports `@hono/swagger-ui`; nothing in `src/`
  imports it. (Meanwhile the old README advertised a `/ui` Swagger route that never existed
  — now corrected, see §7.)
- **Proposed fix:** either **(a)** wire up Swagger UI at `/ui` so the dependency is used and
  the original README claim becomes true, or **(b)** drop the dependency. Recommend (b) unless
  you want both doc UIs — Scalar already serves at `/`.

### 2.5 Inverted / double-negative IoC scan predicate

- **Where:** [`src/ioc/decorator.ts`](src/ioc/decorator.ts)
  ```ts
  export function isManualRegistrationSet(constructor) {
      return !constructor.prototype?.manualRegistration; // returns true when NOT manual
  }
  ```
  The name says "is manual registration set" but it returns `true` when it is _not_ set,
  and the `@IOCManualRegistration` decorator actually _excludes_ a class from auto-scanning.
  Reading the call-site in [`Scanner.ts:38`](src/ioc/Scanner.ts) requires untangling a triple
  negative.
- **Proposed fix:** rename to `shouldAutoRegister()` and the decorator to `@ExcludeFromScan`
  (or `@SkipAutoRegister`). Pure clarity, no behavior change.

---

## 3. P2 — Structural refactors (higher effort/risk — gate behind tests)

### 3.1 `PromptService.ts` is a 1,339-line god-class

- **Where:** [`src/service/PromptService.ts`](src/service/PromptService.ts).
- **Responsibilities tangled in one class:** the agentic-RAG loop, the research /
  verification / generation phases, RAG search, LLM reranking dispatch, failure
  classification, doc ranking/filtering, transcript cleaning, and prompt assembly.
- **Proposed fix:** split into focused collaborators — e.g. `ResearchAgent`,
  `VerificationAgent`, `GenerationAgent`, `FailureClassifier`, `RagSearch` — leaving
  `PromptService` (or a `PipelineOrchestrator`) as a thin coordinator. The `prompt/`
  subfolder (`agenticLoop.ts`, `templates.ts`, `constants.ts`, `helpers.ts`, `types.ts`)
  shows this decomposition was already started; finish it.
- **Effort:** 1–2 days. **Risk:** medium-high — this is the heart of the pipeline.
  **Do not start without characterization tests** (§6).

### 3.2 `Executor.ts` mixes orchestration with a ~200-line inlined JS harness

- **Where:** [`src/service/Executor.ts:560-720`](src/service/Executor.ts) embeds the
  in-container Node harness (the `globalThis.fetch` interceptor that emits the
  `___HTTP_LOG_START___ / ___END___` markers and the axios-error serializer) as a big
  string literal inside the orchestration class.
- **Proposed fix:** extract the harness to its own file (e.g. `src/sandbox/harness.ts`
  exporting the template), so the orchestration logic is readable and the harness can be
  unit-tested in isolation (it has real logic: circular-ref handling, axios detection).
- **Effort:** ~half a day. **Risk:** medium — the marker-parsing contract between harness
  and `runStepInDocker` must stay in sync; a test on that round-trip would de-risk it.

### 3.3 Repositories are split across two folders (inconsistent data layer)

- **Where:** `ProjectRepository`, `FileRepository`, `JobRepository`, `ReportRepository`,
  `TestSuiteRepository` live in [`src/service/`](src/service/), but `BaseRepository` and
  `TraceRepository` live in [`src/db/mongo/`](src/db/mongo/). All five service-folder repos
  extend `BaseRepository` from the db folder.
- **Proposed fix:** move all `*Repository.ts` into `src/db/mongo/` (or a dedicated
  `src/repository/`) so the persistence layer is in one place and `src/service/` holds only
  business logic. Mechanical but touches many import paths.
- **Effort:** ~1 hr (mostly import churn). **Risk:** low-medium — pure moves; the auto-scanner
  registers `src/service/` and `src/api/` by path, so verify the moved repos are still
  registered (they're constructed as dependencies, so they will be — but confirm).

### 3.4 Custom IoC parses constructor params from `Function.toString()`

- **Where:** [`src/ioc/IOC.ts:13-40`](src/ioc/IOC.ts) — `ReflectUtils` regex-strips comments
  and extracts constructor parameter _names_ from the stringified class, then resolves
  dependencies by matching those names against registered keys.
- **Why it's fragile:** it depends on source text surviving verbatim (breaks under any
  minification/renaming — fine for Deno today, a landmine if a bundler is ever added), it's
  stringly-typed (a renamed constructor param silently fails to resolve), it has no
  circular-dependency detection, and the base-class recursion only matches a narrow
  `class X extends Y` regex.
- **Proposed fix (optional, only if it's causing pain):** `reflect-metadata` is _already_ a
  dependency — move to decorator/metadata-based injection, or to a small explicit-registration
  container (each binding lists its deps). Either removes the toString() dependency.
- **Effort:** 1 day. **Risk:** high — re-wires application startup. Only worth it if you plan
  to bundle, or if silent resolution failures have bitten you. Otherwise leave it; it works.

---

## 4. P3 — Housekeeping

- **`api.log` is committed** (33 KB runtime log, tracked in git). Add `api.log` (or `*.log`)
  to [`.gitignore`](.gitignore) and `git rm --cached api.log`.
- **`.env` uses the typo'd `ROOKIE_OPEAN_AI_KEY`.** `ConfigService` accepts both spellings
  for back-compat (good), but migrating `.env` to the correct `ROOKIE_OPENAI_KEY` lets you
  eventually delete the fallback in [`ConfigService.ts:165-166`](src/service/ConfigService.ts).
- **`ConfigService` default API key is a placeholder string** (`"12345689ABCDEFG"`) rather
  than failing fast. For local Ollama this is convenient (any non-empty string works); for a
  hosted endpoint it produces a confusing 401 instead of a clear "missing key" error. Consider
  failing fast when `baseURL` points at a non-local host and no key is set.
- **Git history is all `snapshot` commits.** Fine for a thesis repo; squash into meaningful
  messages if this is ever published.

---

## 5. What is already good (leave alone)

- `StructuredLlm` / `retry` — thoughtful structured-output handling with schema→json_object
  runtime degradation, zod repair loop, and backoff+jitter. Production-grade.
- `PlannerService` — cleanly decomposed (load → doc-examples → goals → execute → aggregate),
  well-commented, with batched concurrency and a shared KB.
- Route definitions (`*Route.ts`) — rich OpenAPI descriptions, proper schemas, correct status
  codes. The generated spec is a real asset.
- Docker sandbox command construction — args-array, not a shell string. No injection surface.
- `.env` is correctly gitignored and untracked.

---

## 6. Test coverage: the gate for deeper work

Before any P2 item, add **characterization tests** (tests that pin current behavior) around:

1. **`Executor` marker parsing** — feed canned container stdout containing
   `___HTTP_LOG_START___ … ___END___` and assert `StepResult.httpTrafficLog` parses correctly.
2. **`classifyEnvironmentError`** ([`Executor.ts:432`](src/service/Executor.ts)) — the
   CONFIG-vs-ENVIRONMENT ±5-line keyword logic is pure and high-value to lock down.
3. **IoC resolution** — register a couple of classes with deps and assert correct wiring
   (protects any move to metadata-based DI in §3.4).
4. **`gapsSimilar` / regression matching** ([`PlannerService.ts:429`](src/service/PlannerService.ts))
   — pure function, easy to test, central to the experiment results.

These are fast, dependency-free unit tests that directly buy down the risk you flagged
(thin coverage) and make the P2 refactors safe.

---

## 7. README corrections applied

You approved fixing the existing `README.md` in place. Applied edits:

1. **Docs UI routes corrected.** The README advertised `http://localhost:3000/reference`
   (Scalar) and `/ui` (Swagger UI). Neither exists. Reality (per [`src/App.ts:67-81`](src/App.ts)):
   Scalar UI is served at the **root `/`** and the raw OpenAPI document at **`/docs`**.
   Updated to match.
2. **File-upload path corrected.** The Workflow section referenced `POST /files`; the actual
   endpoint is `POST /files/upload` (single) / `POST /files/upload-many` (batch), per
   [`src/api/file/FileRoute.ts`](src/api/file/FileRoute.ts).
3. **Missing env vars documented.** Added `ROOKIE_PARALLEL_GOALS`,
   `ROOKIE_SANDBOX_STEP_TIMEOUT_MS`, and `ROOKIE_SANDBOX_NETWORK_NAME` (all present in
   [`ConfigService.ts`](src/service/ConfigService.ts) but undocumented).
4. **Planner endpoints documented.** Clarified that `POST /planner/run` and
   `POST /planner/rerun` stream **NDJSON** progress (`application/x-ndjson`), which the prior
   Workflow section omitted.

See `README.md` for the changes. (These are the only source-tree edits made; everything in
§1–§4 awaits your go-ahead.)
