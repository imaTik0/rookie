# `scripts/` — experiment and launcher tooling

Everything that runs **outside** the Rookie server lives here: the
documentation-drift experiment procedure, orchestration of the full sample, the
reporting tools, and a small launcher for development mode.

The system itself is in `../src/`. Run artefacts — reports, patches, logs — are
**not** kept here; they live in `../../docs_and_raports/`.

---

## What's in here

| File | Role |
|---|---|
| `experiment-runner.ts` | four-phase procedure for a **single** target |
| `run-all-experiments.ts` | orchestrates the full sample (every target) |
| `run-ablation-nofreeze.sh` | no-freeze arm, replayed on the shared baseline |
| `report-all.ts` | aggregate results across targets (console + HTML) |
| `reportAllHtml.ts` | HTML renderer — a module, not a runnable script |
| `report-ablation.ts` | compares the two arms of the code-freeze study |
| `print-report.ts` | inspects a single report JSON |
| `recompute-step-drift.ts` | backfills metrics into older reports, offline |
| `run-both.ts` | runs backend and frontend together |
| `experiments/targets.ts` | target configs + the golden dataset |
| `experiments/preflight.ts` | technical validation of targets before a run |
| `experiments/SELECTION.md` | pre-registered selection protocol |

---

## Before running an experiment

The drift procedure needs a **running Rookie instance** and its backing
services:

- MongoDB, Qdrant and Docker available locally,
- an OpenAI-compatible model endpoint (configured in `../.env`),
- the backend up via `deno task start` in the parent directory.

Environment variables the scripts read:

| Variable | Meaning | Default |
|---|---|---|
| `ROOKIE_URL` | address of the running instance | `http://localhost:3000` |
| `ROOKIE_PARALLEL_GOALS` | goals executed concurrently within one target | from system config |

The sandbox must be able to reach the npm registry — targets install real
libraries at both versions.

---

## Drift experiment — one target

```bash
deno task experiment --config ky
```

The run has four phases: index the older version's documentation, execute the
goals against the **old** package version (the baseline), re-execute **the same
programs** against the new version, then compare the two phases as matched
pairs.

List the available target keys:

```bash
deno run --allow-all scripts/experiment-runner.ts --list
```

### Flags

| Flag | Effect |
|---|---|
| `--config <key>` | target to run; defaults to `execa` |
| `--verbose`, `-v` | full run logging |
| `--fresh` | discard the checkpoint and start over |
| `--no-freeze` | phase 3 **regenerates code** instead of replaying the frozen programs |
| `--ablation` | adds a no-docs arm, measuring the documentation's contribution |
| `--project-id <id>` | manual resume: skip indexing |
| `--baseline-id <id>` | manual resume: skip the baseline phase |
| `--list` | print available targets and exit |

### Crash resilience

After each phase the runner writes `experiment-<config>-checkpoint.json` holding
the project and master-plan ids. On restart it **resumes automatically** —
completed phases are skipped and their results re-fetched from Rookie's
database. The checkpoint is deleted on success; `--fresh` discards it.

Manual resume from known ids (for example when the checkpoint was lost):

```bash
deno run --allow-all scripts/experiment-runner.ts --config ky \
  --fresh --project-id <projectId> --baseline-id <masterPlanId>
```

Order matters: `--fresh` clears the checkpoint first, and the overrides then
seed it.

---

## Drift experiment — full sample

```bash
deno task experiment:all
```

Targets run **concurrently** (each has its own container name and host port),
and goals run concurrently within each target. Behaviour:

- a target that already has a final report on disk is **skipped** — the batch is
  safe to rerun after a crash,
- a target with a checkpoint resumes from its last completed phase,
- one target failing does not stop the others,
- in parallel mode the live view is `logs/<config>.log`.

### Flags

| Flag | Effect |
|---|---|
| `--jobs N` | cap concurrent targets (`--jobs 1` = sequential, with console output) |
| `--only a,b` | run only these targets |
| `--skip a,b` | exclude these targets |
| `--dry-run` | show the plan, run nothing |
| `--bail` | stop launching new targets after a failure |
| `--include-pilots` | also run pilot targets |

The methodology flags — `--no-freeze`, `--ablation`, `--fresh`, `--verbose` —
are **forwarded to every target**. The run header states which protocol is in
effect, so an ablation run cannot pass unnoticed.

> **Note:** targets with an existing report are skipped, so an ablation run
> needs the previous run's reports moved aside first.

```bash
deno task experiment:all --jobs 3 --only ky,execa
deno task experiment:all --no-freeze          # whole sample without freezing
```

### Long runs

A full sample takes hours. The `:awake` variants wrap the command in
`caffeinate` so macOS does not sleep halfway through:

```bash
deno task experiment:awake --config ky
deno task experiment:all:awake
```

---

## The no-freeze arm

```bash
scripts/run-ablation-nofreeze.sh
```

The script replays **the same baseline** as the frozen run: for each target it
carries a hardcoded `--project-id` and `--baseline-id`, so phases 1 and 2 are
skipped and only phase 3 is recomputed with `--no-freeze`. Freezing is therefore
the single variable between the arms.

It runs **sequentially** on purpose — the two arms must not contend for the same
containers.

The ids are hardcoded and belong to one specific run. After repeating the
experiment from scratch they have to be regenerated from the reports'
`meta.projectId` and `baseline.masterPlanId` fields.

---

## Reports

### Aggregate across targets

```bash
deno task report:all                      # console
deno task report:html                     # also writes results.html
deno run --allow-read --allow-write scripts/report-all.ts --dir <directory>
```

Reads the newest report per target from the given directory (default
`../docs_and_raports/wyniki-eksperymentow`) and shows goal- and step-level pass
rates for both phases, regressions, breaking-change detection, and how
faithfully the generated code used the documented API.

`--dir` lets you re-render an **archived** run — this is how the frozen arm's
report is reproduced:

```bash
deno run --allow-read --allow-write scripts/report-all.ts \
  --dir ../docs_and_raports/archiwum-przebiegow/kopia-with-freeze \
  --html frozen-arm.html
```

The HTML is self-contained: styles, syntax highlighting and all data are inlined
in one file, with no network requests. The renderer lives in `reportAllHtml.ts`
and is not runnable on its own.

### Comparing the two arms

```bash
deno task report:ablation
deno run --allow-read --allow-write scripts/report-ablation.ts \
  --freeze-dir <directory> --ablation-dir <directory> --html <file>
```

Compares the frozen arm against the regenerated one. It starts with an
**integrity gate** — checking that the baseline master-plan ids, the frozen
flags and the baseline step counts agree between arms. The gate's verdict goes
into a prominent header, so a comparison built on unpaired arms cannot be
mistaken for a valid one.

Beyond pass rates it reports the number of discordant pairs (where the arms
differ most), whether phase-3 code is identical across arms, and how golden
dataset identifiers migrate between them.

### A single report

```bash
deno run --allow-read scripts/print-report.ts <report.json>          # overview
deno run --allow-read scripts/print-report.ts <report.json> --goals  # + goals
deno run --allow-read scripts/print-report.ts <report.json> --gaps   # + gaps
deno run --allow-read scripts/print-report.ts <report.json> --full   # everything
```

---

## Targets

`experiments/targets.ts` holds every target's configuration: the version pair,
the runtime mode (`pure` / `http` / `db`), the source of the older version's
documentation, and the **golden dataset** — the documented breaking changes with
the keywords used when scoring detection.

Selection criteria and the replacement rule are documented in
[`experiments/SELECTION.md`](experiments/SELECTION.md).

### Technical validation before a run

```bash
deno run --allow-all scripts/experiments/preflight.ts --config ky
deno run --allow-all scripts/experiments/preflight.ts --all
deno run --allow-all scripts/experiments/preflight.ts --all --skip-pilots
```

For each target it checks that the npm version pair resolves, that the container
image starts and becomes healthy (`http` and `db` modes), and that every docs
file at the old version tag is reachable. `pure` targets skip the container
checks. Everything is torn down afterwards.

A target failing preflight is **never silently swapped** — replacement follows
the rule in SELECTION.md §6, and the failure is recorded in §11.

---

## Backfilling metrics into older reports

```bash
deno run --allow-read --allow-write scripts/recompute-step-drift.ts --dry-run
deno run --allow-read --allow-write scripts/recompute-step-drift.ts
deno run --allow-read --allow-write scripts/recompute-step-drift.ts --dir <directory>
```

Fills in `stepDrift` and a corrected `changelog.detection` for reports produced
before those metrics existed. Everything needed is already on disk — the
per-step records in `*-full-reports.json` — so the recomputation runs
**offline**: no Rookie instance, no Docker, and no rerunning of any experiment.

Reads from `../docs_and_raports/wyniki-eksperymentow` by default; `--dir` points
it elsewhere. Run with `--dry-run` first — writing overwrites the report files
in place.

---

## Development mode

```bash
deno task dev      # backend (watch) + frontend (dev)
deno task prod     # backend (start) + frontend (preview)
```

`run-both.ts` runs both processes in parallel. When either exits, the other is
terminated and the script exits with the same code.

---

## Common scenarios

**First full run.** Bring up Rookie and its services, validate the targets
(`preflight.ts --all`), run `deno task experiment:all:awake`, then
`deno task report:all`.

**Repeating one target.** Remove its report from the results directory —
otherwise it is skipped — then run
`deno task experiment --config <key> --fresh`.

**Studying the effect of freezing.** Move the frozen run's reports into the
archive, run `scripts/run-ablation-nofreeze.sh`, then
`deno task report:ablation` pointing at both directories.

**An interrupted run.** Re-issue the same command — the runner resumes from its
checkpoint. To skip indexing and the baseline phase explicitly, pass
`--fresh --project-id ... --baseline-id ...`.
