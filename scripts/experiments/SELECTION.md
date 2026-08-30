# Experiment target selection — 2026 npm libraries (changelog-driven drift)

_Pre-registered target-selection protocol for the documentation-drift experiment.
Written before the experiment is run so the choice of targets cannot be tuned to
outcomes._

## 0. Why this revision (rationale for the pivot)

Two earlier attempts failed on **construct validity**, not mechanics:

1. **Self-hosted service APIs** — fragile infra (9/20 preflight failures: image
   tags, moved docs, auth/health).
2. **Mature ORM / DB libraries** — the model writes correct code from memory,
   ignoring the provided docs, so baseline ≈ experiment (no drift signal);
   confirmed on a live `drizzle` run (baseline 7/8, experiment 8/8, zero
   regressions) because 0.30→0.44 has no runtime-breaking change for the
   exercised API and the model knows drizzle anyway.

This revision fixes the root cause with three levers:

- **2026-only version pairs.** The **NEW** version is released **after the
  model's January-2026 knowledge cutoff**, so its breaking changes cannot be
  memorised — the model MUST rely on the OLD documentation. (The model may know
  the OLD version; that is fine — the baseline should pass.)
- **Changelog-driven goals + golden dataset.** Goals are seeded from the real
  upstream changelog of each pair so they exercise the documented **breaking
  changes** (valid on old, broken on new); the same breaking changes are the
  ground truth for detection recall. See §7 and
  [`src/eval/changelogSeed.ts`](../../src/eval/changelogSeed.ts).
- **npm packages, Docker optional.** Targets are ordinary npm packages; a target
  uses a database container only if it needs one (Postgres for the ORMs). Most
  are pure libraries that run in the sandbox with no container.

## 1. Population (sampling frame)

Frame = npm packages that (a) published a **new major whose `x.0.0` release date
is ≥ 2026-01-15** (safely after the model cutoff) and (b) are widely used
JavaScript/TypeScript libraries indexed under the npm keywords `cli`,
`http`, `orm`, `validation`, `build`, `database`, or listed in _awesome-nodejs_.
Version timelines were read from the npm registry `time` map (snapshot
2026-07-26).

## 2. Pilot exclusion

Harness bring-up used the earlier (non-2026) libraries; none of them appears in
this sample, so no target is both tuned against and measured.

## 3. Eligibility criteria (method-imposed)

A frame member is eligible iff it satisfies **all** of E1–E6:

- **E1 — post-cutoff breaking release.** The NEW version's major `x.0.0` was
  released in 2026 (≥ 2026-01-15), and its upstream changelog / migration guide
  **enumerates developer-visible breaking changes** (not only internal/build
  changes).
- **E2 — runtime-observable breaking change.** At least one breaking change is
  observable at runtime in plain Node.js (a removed/renamed export or option, a
  changed signature or return/behaviour) — not a TypeScript-only type change,
  which a JS sandbox cannot see (threat noted in §10).
- **E3 — full prose docs for the OLD version.** The OLD version's narrative
  documentation is ingestible as versioned in-repo markdown at the tag, or a live
  versioned docs site (documentation conditions unchanged from the prior
  protocol).
- **E4 — installable & runnable in the sandbox.** Installs from npm into
  `node:24-slim`; runnable either as a pure library or against a single
  containerised database engine (no multi-node topology — see the single-instance
  rule in the goal prompt).
- **E5 — real-world use.** Widely used (established package with a version
  history), so its docs are substantial and the drift is representative.
- **E6 — diversity.** Spread across library **types** (CLI parser, HTTP client,
  ORM, build tool, process/exec, markdown, low-level HTTP) so results are not an
  artefact of one ecosystem.

## 4. Selection rule

From the eligible frame, admit targets spanning the type/diversity axis (E6),
preferring pure libraries (no container) and the clearest runtime-breaking
changelogs, until **10** are chosen. Version pairs: OLD = last stable of the
major **before** the 2026 major; NEW = latest stable of the 2026 major.

## 5. Chosen sample (n = 10)

| #  | package           | type           | old → new       | runtime¹ | new released |
| -- | ----------------- | -------------- | --------------- | -------- | ------------ |
| 1  | `commander`       | CLI parser     | 14.0.3 → 15.0.0 | pure     | 2026-05      |
| 2  | `execa`           | process exec   | 9.6.1 → 10.0.0  | pure     | 2026-07      |
| 3  | `got`             | HTTP client    | 14.6.6 → 15.1.0 | http     | 2026-07      |
| 4  | `ky`              | HTTP client    | 1.14.3 → 2.0.2  | http     | 2026-04      |
| 5  | `eslint`          | linter (API)   | 9.39.5 → 10.8.0 | pure     | 2026-07      |
| 6  | `vite`            | build tool     | 7.3.6 → 8.1.5   | pure     | 2026-07      |
| 7  | `typeorm`         | ORM            | 0.3.31 → 1.1.0  | db       | 2026-05      |
| 8  | `@mikro-orm/core` | ORM            | 6.6.16 → 7.1.7  | db       | 2026-03      |
| 9  | `undici`          | HTTP (low-lvl) | 7.29.0 → 8.9.0  | http     | 2026-04      |
| 10 | `marked`          | markdown       | 17.0.6 → 18.0.7 | pure     | 2026-07      |

¹ Runtime (see [`targets.ts`](targets.ts)): **pure** = no container, empty `ctx`;
**http** = a throwaway `mccutchen/go-httpbin` container, `ctx.baseUrl` points the
code at it; **db** = a throwaway `postgres:16` container, `ctx.connectionString`
points the code at it. Any container image is held constant across both phases.

**Type spread:** 2 HTTP clients + 1 low-level HTTP, 2 ORMs, 1 CLI parser, 1
process-exec, 1 linter, 1 build tool, 1 markdown parser. **Container use:** 5 of
10 (2 Postgres for the ORMs, 3 httpbin for the HTTP clients); the other 5 run
pure in the sandbox.

## 6. Reserve queue

Additional 2026-major libraries verified during screening, in order:
`slonik` 48→49 (Postgres), `better-sqlite3` 12→13 (SQLite; N-API rebuild),
`nanoid` 5→6 (thin docs), `vite`/`undici` already selected. A target failing
technical preflight is replaced by the next reserve and logged in §11.

## 7. Changelog-driven goals + golden dataset

For each target the documented **breaking changes** are curated once, from the
pinned upstream changelog (`changelogUrl`), in
[`src/eval/changelogSeed.ts`](../../src/eval/changelogSeed.ts) as items
`{summary, oldUsageHint, kind, expectedCategory, matchKeywords}`. Each item does
double duty:

- **Seed (goal generation only).** `renderChangelogSeed()` steers the planner to
  generate goals a developer following the OLD docs would write, exercising the
  `oldUsageHint` areas — valid on old, broken on new. Injected **only** into goal
  generation, never the code-writing phase, so the code is still written from the
  OLD docs and genuinely breaks on the new version; the goal text is instructed
  not to reveal the version/changelog framing.
- **Golden dataset (ground truth).** `scoreBreakingChanges()` matches the drift
  the pipeline surfaced (experiment-run gap reasoning/fragments/fixes, per-goal
  findings, regressed goals) against the items and reports **recall** — the
  headline metric, written to the report under `changelog.detection`.

Representative breaking changes (full list in the module): commander → ESM-only,
`--no-*` default change; execa → `execaCommand()` removed; got → `.cancel()` /
`isStream` removed, 300/304 no longer auto-followed; ky → `prefixUrl`→`prefix`,
`error.response.json()`→`error.data`; eslint → removed `SourceCode` methods,
`nodeType` in `LintMessage`; vite → esbuild→oxc/rolldown; typeorm →
`Connection`→`DataSource`; mikro-orm → `getKnex()`→`getKysely()`; undici →
legacy handler wrappers removed; marked → table/heading tokenizer change.

## 8. Drift protocol (per target)

1. **Index** the OLD-version full docs → Rookie project.
2. **Baseline** — install `<pkg>@<oldVersion>`; run the master plan with goals
   seeded from the changelog (goals pass, since docs match the old version).
3. **Experiment** — re-run the same goals with `<pkg>@<newVersion>` installed;
   goals hitting breaking changes fail → drift.
4. **Report** — diff summaries, score breaking-change recall, save JSON + bundle.

Only the library version differs between phases; any database engine is held
constant. Connection/endpoint details are injected via `ctx`.

## 9. Runner support

The runner ([`experiment-runner.ts`](../experiment-runner.ts)) supports all three
runtimes directly. Each target declares a `runtime` in [`targets.ts`](targets.ts);
the runner starts a container only for `http`/`db` targets (held constant across
both phases) and skips all Docker for `pure` targets, whose `ctx` is empty. The
version-pinned OLD docs are fetched as raw markdown from GitHub, so indexing
never needs a container. Run one target with `--config <key>`, the whole sample
with `deno task experiment:all`.

## 10. Threats to validity

- **Type-only breaking changes are invisible.** The sandbox runs plain JS (no
  `tsc`); TypeScript-only breaks (e.g. some drizzle/vite type changes) cannot be
  observed. E2 restricts the golden dataset to runtime-observable items;
  type-only drift is out of scope for this experiment.
- **Non-throwing behavioural drift.** A changed default/return shape that does
  not throw is only caught if the generated program asserts the OLD-documented
  outcome — the generation prompt requires such verification, but coverage is
  imperfect.
- **Model still partially knows the OLD API.** Acceptable: the baseline is
  supposed to pass; what matters is that the NEW breaking behaviour is
  post-cutoff, so the model cannot silently write new-API code and mask drift.
- **Curation depth.** 2–3 breaking changes per target (the clearest, runtime
  observable). Recall is reported against this curated set, not every line of the
  changelog.

## 11. Deviation log

_(empty — to be filled only via the replacement rule in §6.)_
