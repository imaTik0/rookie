# Documentation mutation testing — technical reference

This document describes exactly how the mutation-testing subsystem works (the
protocol modelled on MuTAP, but applied to **documentation** rather than code),
which corpora it uses, and what it needs to run.

## 1. Where it lives

| File                                       | Role                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| [`mutation.ts`](./mutation.ts)             | pure engine: operators, site enumeration, mutant generation, detection matching          |
| [`mutation.test.ts`](./mutation.test.ts)   | 26 unit tests of the engine (no infrastructure needed)                                   |
| [`mutationCorpus.ts`](./mutationCorpus.ts) | the golden corpus: full, version-pinned documentation of a post-cutoff release           |
| [`runMutation.ts`](./runMutation.ts)       | protocol driver: golden baseline → mutants → metrics → JSON report                       |
| [`metrics.ts`](./metrics.ts)               | reusable metrics: `detectionMetrics`, `cohenKappa`, `confusionMatrix`, `perLabelMetrics` |

Task: `deno task eval:mutation` (defined in `deno.json`); `eval:mutation:awake`
wraps it in `caffeinate` for long runs.

## 2. Concepts

- **Golden corpus** — documentation of confirmed quality (the baseline must
  reach ≥ 90% goal pass rate; constant `GOLD_PASS_THRESHOLD = 0.9`).
- **Mutation site** (`MutationSite`) — a specific location in the corpus where
  an operator can apply (file, line range, and for types the occurrence index
  on that line).
- **First-order mutant** (`Mutant`) — a copy of the whole corpus with **exactly
  one** mutation applied, together with its ground truth: the operator, the
  expected gap category, the _wound_, and the keywords.
- **Wound** (`woundLine`) — the 1-based line where the injected gap "lives",
  expressed in the coordinates of the **mutated** file (the mutated corpus is
  what gets indexed, and what the classifier verifies quotes against). For
  deleting operators the wound points at the deletion site (lines below shift up).

## 3. Mutation operators

Each operator carries an expected category (`EXPECTED_GAP`).

### 3.1 `DelParam` → `MISSING`

Deletes **a single line** describing a parameter or header. Sites are recognised
by three patterns (outside code fences):

| Style           | Pattern (essence)                                                                        | Example                               |
| --------------- | ---------------------------------------------------------------------------------------- | ------------------------------------- |
| bullet          | ``^[-*] `name` … (string\|number\|integer\|boolean\|required\|optional\|header\|token)`` | ``- `size` (number, optional): …``    |
| bold definition | ``^**`name`** … (type/required/optional)``                                               | ``**`token`** (string, required): …`` |
| table row       | ``^\| `name` \| … type/required``                                                        | ``\| `limit` \| number \| …``         |

Ground-truth keywords: the name of the deleted parameter.

### 3.2 `DelExmpl` → `MISSING`

Deletes **an entire fenced example block**, fences included. Blocks are found by
pairing fence lines (`fenceBlocks`); blocks whose body is shorter than 10
characters are skipped. Keywords: the first identifier called in the code
(pattern `name(`) and the nearest heading above the block.

### 3.3 `ObfuscateType` → `AMBIGUOUS`

Replaces a precise type with the generic `string`. Types are matched by
`PRECISE_TYPE_RE`:

```
number | integer | boolean | float | ISO-8601 / ISO 8601 | timestamp | array of <word>
```

**Every occurrence** of a type outside fences is a separate site — several types
on one line means several sites, distinguished by the (1-based) `occurrence`
field; `applySite` replaces **exactly the n-th** occurrence and leaves the rest
untouched. This includes return-value sentences ("Returns a number …").
Keywords: the backticked parameter name from that line if present, otherwise the
type itself, plus `string`.

### 3.4 `AddFalseInfo` → `INCORRECT`

Inserts a false but plausible parameter after an existing parameter line (exact
text in the constant `FAKE_PARAM_LINE`):

```
- `xVerifyMode` (string, required): verification mode for this call — must be set to `"strict"`, otherwise the request is rejected.
```

The name `xVerifyMode` is synthetic — it appears in no real API — so the keyword
gives an unambiguous matching signal. Sites: the same parameter lines as
`DelParam`.

## 4. Generating mutants (`generateMutants`)

1. `enumerateSites(files)` collects every site for every operator.
2. Per operator the site pool is **deterministically shuffled** with a
   _mulberry32_ generator seeded by `seed` (default 1) — the same seed plus the
   same corpus yields an identical mutant set.
3. `perOperator` sites are taken (a number, default 2), or **all** of them with
   `perOperator: "all"` — the exhaustive mode, one mutant per site.
4. Each site is applied to a fresh copy of the corpus (`applySite`), which
   guarantees first-order mutants.

Mutant id: `<Operator>-<file>-L<line>`, suffixed `-oN` for type occurrences
N > 1 (e.g. `ObfuscateType-USING_PRO.md-L481-o2`) — ids are unique and stable
across runs.

The helper `siteInventory(files)` returns the size of the potential mutant pool
per operator plus the total (printed in dry-run mode).

## 5. Detection matching (`gapMatchesMutant`)

A reported gap (`documentationGapDetails` from the MASTER_PLAN report) **matches**
a mutant when either condition holds:

1. **Positional**: the fragment is `verified`, points at the same file, and the
   mutant's wound falls within `[lineStart − 8, lineEnd + 8]`
   (`WOUND_TOLERANCE_LINES = 8`);
2. **Lexical** (fallback): any of the mutant's keywords appears
   (case-insensitively) in the combined text
   `reasoning + suggestedDocsFix + fragment`.

The label predicted for classification is the category of the best match,
preferring a **positionally verified** one.

## 6. Run protocol (`runMutation.ts`)

For each golden corpus:

**Phase 0 — golden baseline.** The corpus documentation is fetched and uploaded
(`POST /files/upload-many`), a project is created (`POST /projects`), and a fresh
master plan is run (`POST /planner/run`, NDJSON stream,
`maxGoals = corpus goal count`, `initialContext = "{}"`), with the library
**pinned to the documented version in the sandbox** (`packageOverrides`) —
correct docs ⇒ working code. From the report it reads:

- the goal **pass rate** — below `90%` the corpus fails the golden-standard
  requirement and its mutant results are flagged as unreliable;
- **false alarms** — gaps reported against the golden corpus (the FP-rate base);
- `masterPlanId` — for reruns;
- `masterPlanGoals` — the goal texts, used to target mutants at goals.

Instead of a fresh run you can pass `--gold <masterPlanId>`: the driver fetches
the stored report (`GET /reports/{id}`) and skips phase 0 entirely. The id to
reuse is printed after every fresh golden run.

**Phase 1 — mutants.** For each mutant: upload the mutated files → new project →
`POST /planner/rerun` with the golden run's `masterPlanId` — **the same goals,
with no second (non-deterministic) generation**, which is what makes the runs
comparable. The rerun is **targeted**: `relevantGoalIndices` (`mutation.ts`) maps
a mutant onto the goals that could touch the wounded fragment (first filtering by
the library name taken from the filename, then narrowing by `goalHints` — the
function identifier from the section heading; each stage falls back safely to a
wider pool, so targeting never removes the only goal able to find the wound).
The chosen indices go into the request's `goalIndices` field, and the
doc-examples smoke phase is skipped (`skipDocExamples: true` — none of the four
operators leaves a signal there). Mutants may run in parallel
(`--concurrency N`); a failure in a single run is recorded in its `error` field
and **excluded from the MDS denominators** without aborting the protocol. The
result is scored by `gapMatchesMutant`.

> **Why targeting is methodologically sound:** MDS asks whether the system
> detects a defect _when it exercises the affected fragment_. Goals unrelated to
> the wound offer no detection opportunity — they only add cost and false-alarm
> surface, and false alarms are measured once, on the golden baseline.

**Metrics** (per corpus):

- `MDS = detected / total` — overall and per operator (the _Mutation Detection
  Score_; this is detection recall);
- classification scored **on detected mutants only**: confusion matrix
  (`confusionMatrix`), precision/recall/F1 per category (`perLabelMetrics`),
  and **Cohen's κ** (`cohenKappa`);
- the pass rate of each mutant run (a drop against the golden baseline signals
  that the mutation actually "hurt").

**Report**: `mutation-<timestamp>.json` in the working directory:

```jsonc
{
  "startedAt": "...", "seed": 1, "perOperator": "all",
  "concurrency": 4, "goldReused": "mp_abc123",   // absent on a fresh golden run
  "corpora": [{
    "fixture": "marked@18",
    "gold": { "passRate": 1.0, "falseAlarms": 0, "met": true },
    "mutants": [{ "mutant": "DelParam-USING_ADVANCED.md-L52", "operator": "DelParam",
                  "expected": "MISSING", "detected": true,
                  "predicted": "MISSING", "passRate": 0.86,
                  "goalsRun": 1 }],                // goals covered by the targeted rerun
    "erroredRuns": 0,                              // runs that errored (excluded from MDS)
    "perOperator": { "DelParam": { "total": 8, "detected": 6, "mds": 0.75 }, ... },
    "overallMds": 0.85, "kappa": 0.79,
    "confusion": { ... }, "perLabel": { ... }
  }]
}
```

## 7. Golden corpus — marked@18 (post-cutoff)

The active corpus is the **full, version-pinned documentation of marked@18**,
defined in [`mutationCorpus.ts`](./mutationCorpus.ts) and fetched at run time
from the repository at tag `v18.0.7` (2 files: `USING_ADVANCED.md`,
`USING_PRO.md`). The pool is 73 potential mutants — DelParam 8, DelExmpl 38,
ObfuscateType 19, AddFalseInfo 8.

**Why a post-cutoff release.** A corpus drawn from libraries the model knows well
is useless: the model writes correct code from memory despite the injected
documentation defect, so every mutant survives (≈ 0 detection). marked 18.0.7 was
released **after the model's January-2026 knowledge cutoff**, so the model cannot
bypass the documentation — a mutated document genuinely misleads it, and mutants
become detectable. The library is pinned to the documented version in the sandbox
(`packageOverrides`), so correct docs ⇒ working code (gold passes) and mutated
docs ⇒ broken code (mutant detected).

**Why marked specifically.** It is **pure** (a Markdown parser, no network — a
context without URLs exempts the runs from the grounded-success requirement) and
its whole API is a call plus an options object, which keeps generated goals on
the mainstream surface where the golden baseline is attainable. The drift study
measured a 90% step-level baseline for this library, right at the threshold this
protocol requires.

> **execa@10 is retained in `mutationCorpus.ts` for provenance only.** It was the
> original corpus but failed the golden standard at 48% step level: with 16 doc
> files the planner drifts into the most exotic corners of the API (IPC
> serialisation, stream transforms, pipe chains), which the agent fails even on
> pristine documentation. Its 420-mutant pool is also impractical. Select it
> explicitly with `--library execa` if you want to reproduce that finding.

Operators recognise both parameter bullets and **option headings in the style of
real API docs** (`#### option` followed by a `_Type:_`/`Default:` line).

> `goldCorpus.ts` remains in the repository purely as a unit-test fixture
> (`mutation.test.ts` checks pool sizes against it) — it is no longer the
> protocol's corpus.

## 8. Requirements

### 8.1 `--dry-run` mode (no infrastructure)

Needs only Deno 2.x. Prints the site inventory and the mutant list — nothing is
executed.

### 8.2 A full run

| Requirement                            | Why                                                                                                                              |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Rookie server (`deno task start`)      | the whole evaluation pipeline                                                                                                    |
| MongoDB                                | projects, suites, reports                                                                                                        |
| Qdrant                                 | vector index of the corpora (each mutant is its own collection)                                                                  |
| Docker                                 | execution sandbox (`node:24-slim`)                                                                                               |
| **sandbox access to the npm registry** | installing the pinned library version in the container (`ROOKIE_SANDBOX_AUTO_INSTALL_DEPS=true`, network mode other than `none`) |
| **access to GitHub (raw)**             | fetching the corpus documentation when the run starts                                                                            |
| OpenAI-compatible LLM backend          | generation, verification, classification                                                                                         |
| Embeddings backend                     | indexing and retrieval                                                                                                           |

`ROOKIE_EVAL_BASE_URL` points at the server (default `http://localhost:3000`).

### 8.3 CLI

```bash
deno task eval:mutation --dry-run                      # inventory + mutant list (no infrastructure)
deno task eval:mutation                                # default: 2 mutants per operator
deno task eval:mutation --per-operator all             # exhaustive (the whole pool)
deno task eval:mutation --seed 42 --per-operator 5     # reproducible subset (20 mutants)
deno task eval:mutation --concurrency 4                # 4 mutants in parallel
deno task eval:mutation --gold <masterPlanId>          # reuse a golden baseline
deno task eval:mutation --library execa                # switch corpus
deno task eval:mutation:awake                          # same, wrapped in caffeinate
```

### 8.4 Cost and recommendations

Cost ≈ `1 golden run + mutant_count × targeted rerun`. Thanks to targeting
(`goalIndices`) a mutant rerun is usually **one agent session** — the goal that
touches the wounded fragment — rather than the corpus's full goal set, and the
example smoke phase is skipped. Recommended:

- while iterating, a small seeded subset (`--per-operator 2`) plus `--gold <id>`
  so the baseline is paid for once; save `--per-operator all` for final numbers,
- `--concurrency 3–4` cuts wall time (the limits are LLM rate limits and Docker
  capacity); results are ordered deterministically,
- several runs with different seeds (`--seed`) rather than one huge run — the
  seed guarantees the subset is reproducible,
- given LLM non-determinism, report results from ≥ 2–3 repetitions (detection
  stability).

## 9. Known limitations

- The **lexical fallback** can match by accident when a parameter name is a
  common word (e.g. `text`); positional matching takes precedence, and
  `xVerifyMode` (AddFalseInfo) is unambiguous by construction.
- **κ is computed on detected mutants only** — classification is scored
  conditional on detection; MDS reports the loss from non-detection separately.
- **A golden corpus below threshold** does not abort the run but marks that
  corpus's results unreliable (`gold.met = false`) — exclude them from analysis.
- Operators work on Markdown; other file types (`.json` and so on) are not
  mutated (enumeration filters on the `md|mdx|txt|rst` extensions).

## 10. Changing the corpus

The corpus is selected by `LIBRARY` in [`runMutation.ts`](./runMutation.ts)
(`--library` overrides it) and defined in
[`mutationCorpus.ts`](./mutationCorpus.ts) under `POST_CUTOFF_CORPORA`. To add
another library, provide:

1. `pkg` + `version` — a **post-cutoff release** (otherwise mutants survive,
   because the model already knows the library),
2. `docBaseUrl` + `docFiles` — the full, version-pinned document set (raw
   Markdown from the repository at the version tag),
3. `maxGoals` and `pure` (whether the library needs a network endpoint or a
   container).

Documentation that mutates well has precise types (ObfuscateType sites),
parameter bullets or API-doc-style option headings (DelParam + AddFalseInfo
sites), and fenced examples (DelExmpl sites). Keep the doc set small: a large
corpus pushes goal generation into exotic API corners, which is what made the
execa baseline fail.
