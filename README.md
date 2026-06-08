<div align="center">
  <img src="rookielogo.png" alt="Rookie API Logo" width="200"/>
</div>

# Rookie API

Rookie is an autonomous system for evaluating the quality of API documentation. The core idea is simple: if a large language model, given only the documentation, cannot write and successfully execute code that integrates with the API — the documentation has a gap worth fixing.

The system combines an agentic RAG pipeline with code execution in isolated Docker containers. A **Master Planner** generates realistic developer goals from the documentation; an **Agentic RAG loop** (Research → Verification → Generation) then attempts to implement each goal from scratch. Every failure is semantically classified — `MISSING`, `AMBIGUOUS`, `INCORRECT`, `CONFIG`, or `ENVIRONMENT` — and paired with a pinpointed documentation fragment and a suggested fix.

This inverts traditional API testing: instead of checking whether software meets its specification, Rookie checks whether the specification is sufficient to use the software.

## Key Features

- **Empirical documentation evaluation**: Quality is measured by whether an LLM can write working code from the docs — not by static linting or schema validation.
- **Semantic gap classification**: Failures are diagnosed as missing information, ambiguous descriptions, incorrect examples, misconfigured requirements, or environment issues.
- **Agentic RAG pipeline**: Three-phase loop (Research → Verification → Code Generation) with self-correcting retrieval and iterative execution feedback.
- **Isolated sandbox execution**: Generated code runs in ephemeral, hardened Docker containers — no side effects on the host, no mock data, real HTTP calls only.
- **Hybrid retrieval (BM25 + dense)**: Reciprocal Rank Fusion over sparse BM25 and dense vector search minimises irrelevant context reaching the LLM.
- **Robust docs ingestion**: Crawls documentation sites using Mozilla Readability (main-content extraction, strips nav/sidebar/footer) and Turndown (clean Markdown with preserved tables and code), probes the `llms-full.txt` standard, and detects unrendered JavaScript pages (e.g. Swagger UI) instead of indexing empty shells.
- **Bounded context management**: The agentic loop keeps long research sessions within the model's context window via LLM distillation of older tool-call history into a dense factsheet — preserving extracted facts instead of truncating them.
- **Runs fully local**: Compatible with any OpenAI-compatible backend — Ollama, vLLM, LM Studio — including small open-source models like Qwen or Gemma.

## Tech Stack

- **Runtime**: [Deno](https://deno.land/)
- **Web Framework**: [Hono](https://hono.dev/) (with `zod-openapi`)
- **Databases**:
  - **MongoDB**: Stores project metadata, file definitions, test suites, and execution reports.
  - **Qdrant**: Vector database for hybrid BM25 + dense search over documentation chunks.
- **AI/ML**:
  - **Any OpenAI-compatible backend**: Chat model for planning, code generation, and failure classification (OpenAI, Ollama, vLLM, LM Studio, …).
  - **Any OpenAI-compatible embeddings API**: Dense embeddings for RAG (Ollama `nomic-embed-text`, OpenAI `text-embedding-3-small`, …).
  - **BM25 (built-in)**: Sparse retrieval computed in-process; IDF applied server-side by Qdrant.
- **Isolation**: **Docker** for running untrusted, AI-generated test scripts.

## Getting Started

### Prerequisites

- [Deno](https://deno.land/) 2.x
- [Docker](https://www.docker.com/)
- [MongoDB](https://www.mongodb.com/)
- [Qdrant](https://qdrant.tech/)

### Infrastructure Setup

Before running the application, ensure you have a Docker network named `rookie-network`:

```bash
docker network create rookie-network
```

Ensure your MongoDB and Qdrant instances are accessible.

### Configuration

Copy `.env` to set your values — the server loads it automatically (`deno task start` uses `--env-file`).

#### Core infrastructure

| Variable                       | Description               | Default                     |
| ------------------------------ | ------------------------- | --------------------------- |
| `ROOKIE_HOST`                  | Server host               | `localhost`                 |
| `ROOKIE_PORT`                  | Server port               | `3000`                      |
| `ROOKIE_MONGO_DB_URL`          | MongoDB connection string | `mongodb://localhost:27017` |
| `ROOKIE_MONGO_DB_NAME`         | MongoDB database name     | `rookie_db`                 |
| `ROOKIE_QDRANT_HOST`           | Qdrant host               | `127.0.0.1`                 |
| `ROOKIE_QDRANT_PORT`           | Qdrant port               | `6333`                      |

#### LLM and embeddings

| Variable                       | Description               | Default                     |
| ------------------------------ | ------------------------- | --------------------------- |
| `ROOKIE_OPENAI_KEY`            | LLM API key (`ROOKIE_OPEAN_AI_KEY` still accepted) | (Required) |
| `ROOKIE_OPENAI_BASE_URL`       | LLM endpoint (OpenAI-compatible; set for Ollama/vLLM) | OpenAI |
| `ROOKIE_OPENAI_MODEL_NAME`     | Chat model                | `gpt-4o-mini`               |
| `ROOKIE_EMBEDDING_MODEL`       | Embeddings model name     | `nomic-embed-text`          |
| `ROOKIE_EMBEDDING_VECTOR_SIZE` | Vector dimensions for the model | `768`                 |
| `ROOKIE_EMBEDDING_BASE_URL`    | Embeddings endpoint (OpenAI-compatible) | OpenAI     |

#### Quality / determinism

| Variable                        | Description                                             | Default       |
| ------------------------------- | ------------------------------------------------------- | ------------- |
| `ROOKIE_LLM_TEMPERATURE`        | Sampling temperature for all calls                      | `0.2`         |
| `ROOKIE_LLM_SEED`               | Optional integer seed (ignored if unsupported)          | (unset)       |
| `ROOKIE_STRUCTURED_OUTPUT_MODE` | `json_schema` \| `json_object` \| `text`                | `json_object` |
| `ROOKIE_LLM_MAX_REPAIR_ATTEMPTS`| Repair retries when JSON fails zod validation           | `1`           |
| `ROOKIE_LLM_MAX_RETRIES`        | Backoff retries on transient 429/5xx/network errors     | `3`           |
| `ROOKIE_LLM_RETRY_BASE_MS`      | Base backoff delay (exponential + jitter)               | `500`         |
| `ROOKIE_LLM_CALL_TIMEOUT_MS`    | Per-call timeout for one LLM completion; raise for slow local models | `300000` |
| `ROOKIE_MAX_CONTEXT_TOKENS`     | Token budget before loop compaction (per-message cap → distillation of old history → initial-context trim) | `12000` |
| `ROOKIE_CLASSIFIER_VOTES`       | Self-consistency votes in the failure classifier        | `3`           |
| `ROOKIE_BM25_K1` / `_B` / `_AVG_LEN` | BM25 sparse-vector parameters                    | `1.5/0.75/256`|

> `json_schema` mode derives a strict JSON Schema from the zod definitions automatically. If a server rejects it, Rookie degrades to `json_object` at runtime — safe to try on capable models, harmless on small ones.

#### Agent limits

| Variable                              | Description                                              | Default  |
| ------------------------------------- | -------------------------------------------------------- | -------- |
| `ROOKIE_MAX_RESEARCH_ITERATIONS`      | Max RAG research iterations per agentic loop             | `5`      |
| `ROOKIE_MAX_VERIFICATION_ITERATIONS`  | Max verification iterations per agentic loop             | `5`      |
| `ROOKIE_DEFAULT_SEARCH_LIMIT`         | Number of chunks fetched per search call                 | `10`     |
| `ROOKIE_RELATED_DOCS_LIMIT`           | Final number of chunks passed to the failure classifier  | `25`     |
| `ROOKIE_MAX_RESULT_CHARS`             | Max characters of a Docker execution result kept in context | `3000` |
| `ROOKIE_MAX_CONTEXT_CHARS`            | Max characters of accumulated agent context              | `50000`  |
| `ROOKIE_MAX_SCENARIO_DOCS_CHARS`      | Max characters of docs passed for scenario planning      | `100000` |
| `ROOKIE_MAX_FILE_READ_CHARS`          | Max characters returned by a single VFS `read_file` before truncation (large files steer the agent to `grep_file` / `search_knowledge_base`) | `16000` |

#### Chunking

> **Note:** changing these values requires re-indexing all projects (`DELETE /projects/:id` and re-create).

| Variable                | Description                                        | Default |
| ----------------------- | -------------------------------------------------- | ------- |
| `ROOKIE_CHUNK_SIZE`     | Target chunk size in characters                    | `1200`  |
| `ROOKIE_CHUNK_OVERLAP`  | Overlap carried into the next chunk for continuity | `150`   |

#### Docs crawling (`POST /projects/from-url`)

| Variable                       | Description                                                                 | Default |
| ------------------------------ | --------------------------------------------------------------------------- | ------- |
| `ROOKIE_SPA_MIN_TEXT_CHARS`    | Below this body-text length + a JS app root (`#swagger-ui`, `#app`, …) a page is treated as an unrendered SPA and skipped | `200` |
| `ROOKIE_READABILITY_MIN_CHARS` | Below this extracted-article length, fall back to direct `main`/`body` extraction (for terse reference pages) | `250` |

#### Sandbox (untrusted-code execution)

| Variable                          | Description                                        | Default          |
| --------------------------------- | -------------------------------------------------- | ---------------- |
| `ROOKIE_SANDBOX_HARDENING`        | Apply non-root/cap-drop/read-only/pids-limit flags | `true`           |
| `ROOKIE_SANDBOX_USER`             | `uid:gid` to run as                                | `1000:1000`      |
| `ROOKIE_SANDBOX_PIDS_LIMIT`       | Max processes (fork-bomb guard)                    | `256`            |
| `ROOKIE_SANDBOX_NETWORK_MODE`     | `network` \| `none` \| `<docker-network-name>`     | `network`        |
| `ROOKIE_SANDBOX_AUTO_INSTALL_DEPS`| `npm install` packages imported by generated code  | `true`           |

> **Egress note:** container hardening covers the in-container attack surface, but
> `docker run` flags cannot allowlist outbound hosts. For real egress control,
> create `rookie-network` as an `--internal` network plus an egress proxy, or set
> `ROOKIE_SANDBOX_NETWORK_MODE=none` for offline library testing.

### Reranking

Rookie re-ranks the top-N BM25+dense candidates before passing them to the LLM, improving precision and reducing noise in the context window. Reranking is **enabled by default** (`llm` mode) and requires no extra services — it reuses the chat model already configured.

#### Mode: `llm` (default — zero extra setup)

Uses the configured chat model to sort retrieved chunks by relevance. Works with any backend including Ollama. Slower than a dedicated cross-encoder but requires no additional infrastructure.

```bash
ROOKIE_RERANKER_MODE=llm
ROOKIE_RERANKER_TOP_N=20   # rank this many candidates, return ROOKIE_RELATED_DOCS_LIMIT
```

#### Mode: `api` (recommended for best quality — cross-encoder)

Calls a Jina/Cohere/TEI-compatible `/rerank` endpoint. A cross-encoder scores each (query, chunk) pair jointly and significantly outperforms listwise LLM reranking.

**Option A — local, free, no GPU required (CPU-only TEI + BGE reranker):**

```bash
docker run --rm -p 8080:80 \
  ghcr.io/huggingface/text-embeddings-inference:cpu-1.6 \
  --model-id BAAI/bge-reranker-v2-m3
```

Then configure Rookie:

```bash
ROOKIE_RERANKER_MODE=api
ROOKIE_RERANKER_BASE_URL=http://localhost:8080
ROOKIE_RERANKER_MODEL=BAAI/bge-reranker-v2-m3
ROOKIE_RERANKER_TOP_N=20
```

**Option B — Jina AI (free cloud tier, 1 M tokens/month):**

Create a free API key at [jina.ai](https://jina.ai) and set:

```bash
ROOKIE_RERANKER_MODE=api
ROOKIE_RERANKER_BASE_URL=https://api.jina.ai/v1
ROOKIE_RERANKER_API_KEY=<your-jina-key>
ROOKIE_RERANKER_MODEL=jina-reranker-v2-base-multilingual
ROOKIE_RERANKER_TOP_N=20
```

| Variable                | Description                                                          | Default |
| ----------------------- | -------------------------------------------------------------------- | ------- |
| `ROOKIE_RERANKER_MODE`  | `off` \| `llm` \| `api` (cross-encoder rerank)                       | `llm`   |
| `ROOKIE_RERANKER_TOP_N` | Rerank this many top candidates before returning `relatedDocsLimit`  | `20`    |
| `ROOKIE_RERANKER_BASE_URL` | Base URL of a Jina/Cohere/TEI `/rerank` endpoint (api mode only)  | —       |
| `ROOKIE_RERANKER_API_KEY`  | Bearer token for the reranker endpoint (api mode only)            | —       |
| `ROOKIE_RERANKER_MODEL`    | Model name passed to the reranker endpoint (api mode only)        | —       |

#### Mode: `off`

Disables reranking entirely. Candidates are returned in raw BM25+dense retrieval order. Not recommended — retrieval noise directly increases hallucination risk in generated code.

---

### Running with small / local models (Qwen, Gemma, …)

Rookie talks to any OpenAI-compatible endpoint, so it runs fully locally. Example with [Ollama](https://ollama.com):

```bash
ollama pull qwen2.5-coder:7b
ollama pull nomic-embed-text

export ROOKIE_OPENAI_BASE_URL=http://localhost:11434/v1
export ROOKIE_EMBEDDING_BASE_URL=http://localhost:11434/v1
export ROOKIE_OPENAI_KEY=ollama                 # any non-empty string
export ROOKIE_OPENAI_MODEL_NAME=qwen2.5-coder:7b
export ROOKIE_EMBEDDING_MODEL=nomic-embed-text
export ROOKIE_EMBEDDING_VECTOR_SIZE=768
# Smaller models are less reliable at strict schemas — json_object + zod repair is the safe default:
export ROOKIE_STRUCTURED_OUTPUT_MODE=json_object
# More votes stabilises classification on small models:
export ROOKIE_CLASSIFIER_VOTES=3
```

Notes for small models:
- Keep `ROOKIE_STRUCTURED_OUTPUT_MODE=json_object` (or `text` for the smallest models). All JSON is validated and repaired against zod schemas regardless of mode.
- BM25 retrieval is computed server-side in Qdrant and is model-independent, so it stays accurate even with a weak LLM.
- If a model's tool-calling is weak, lower `ROOKIE_MAX_RESEARCH_ITERATIONS` to avoid loops.

### Install dependencies

```bash
# Install frontend npm deps (run once from the frontend directory)
cd frontend && npm install
```

Deno backend dependencies are resolved automatically by Deno on first run (via `deno.json` imports).

### Running both services

The repo uses **Deno workspaces** — the root `deno.json` declares `frontend` as a workspace member and provides tasks to start both services at once via [`scripts/run-both.ts`](scripts/run-both.ts).

```bash
# Development — backend (Deno watch + pino-pretty) + frontend (Vite HMR)
deno task dev

# Production — backend + frontend preview
deno task prod
```

If either process exits, the other is terminated automatically.

### Running services individually

```bash
deno task watch    # backend only — hot-reload with pretty logging
deno task start    # backend only — production

deno task --cwd frontend dev      # frontend only — Vite dev server
deno task --cwd frontend build    # frontend only — production build
```

The frontend is available at `http://localhost:5173`, the backend at `http://localhost:3000`.

## Workflow

1. **Add Documentation**: Upload API specification files directly, or crawl a documentation website:
   - `POST /files` + `POST /projects` — upload local files and create a project
   - `POST /projects/from-url` — provide a URL; Rookie ingests it as Markdown and indexes everything automatically. Ingestion is standards-first: if the origin publishes an `llms-full.txt` it is used directly; otherwise the crawler walks up to N same-origin pages, extracting main content with Mozilla Readability and converting to Markdown with Turndown (tables and code blocks preserved). JavaScript-rendered pages (e.g. Swagger UI) are detected and skipped with an actionable error pointing to the raw OpenAPI JSON instead.
2. **Indexing**: The system chunks each file structure-aware (heading boundaries, fenced code blocks preserved), generates BM25 sparse + dense embeddings, and stores them in Qdrant.
3. **Define Test Suite**: Specify the testing goal, execution mode (`TEST_SCENARIO` or `CODE_GENERATION`), and initial context (e.g., auth tokens as JSON).
4. **Execution**:
   - **Master Planner** generates diverse, realistic user goals from the documentation.
   - For each goal, an **Agentic RAG loop** (Research → Verification → Generation) produces and runs JavaScript code in a Docker sandbox.
   - State (`ctx`) is passed between steps; failures are classified semantically (MISSING / AMBIGUOUS / INCORRECT / CONFIG / ENVIRONMENT).
5. **Reporting**: Review structured reports with per-step failure analysis, related documentation fragments, and suggested fixes.

## Experiments

The [`scripts/`](scripts/) directory contains a reproducible **documentation-drift** experiment that uses Rookie to detect when documentation no longer matches a newer software version.

### `experiment-runner.ts`

Indexes the documentation for an **old** version of a Dockerized project, then runs the Master Planner against both the old and a **new** container image. Goals that passed on the old API but fail on the new one mark documentation drift.

```bash
# Rookie must be running (defaults to http://localhost:3000)
deno run --allow-all scripts/experiment-runner.ts --config gitea
deno run --allow-all scripts/experiment-runner.ts --config gitea --verbose
ROOKIE_URL=http://localhost:3000 deno run --allow-all scripts/experiment-runner.ts --config gitea
```

Phases: (1) index docs from the old image → (2) baseline: old docs × old API → (3) experiment: old docs × new API → (4) diff structured summaries and write `experiment-<config>-<ts>.json`. Targets are defined in the `EXPERIMENTS` map at the top of the file — add a key (image tags, container/health config, docs URL, planner goals, optional `setup` hook for credentials) to run the same experiment on another project.

### `print-report.ts`

Pretty-prints a saved experiment report with colourised tables, pass-rate bars, drift diff, and failure taxonomy.

```bash
deno run --allow-read scripts/print-report.ts experiment-gitea-<ts>.json          # overview
deno run --allow-read scripts/print-report.ts experiment-gitea-<ts>.json --goals  # + goals comparison
deno run --allow-read scripts/print-report.ts experiment-gitea-<ts>.json --gaps   # + documentation gaps
deno run --allow-read scripts/print-report.ts experiment-gitea-<ts>.json --full   # everything
```

## API Documentation

Once the server is running, you can access the interactive API documentation at:
`http://localhost:3000/reference` (Scalar) or `http://localhost:3000/ui` (Swagger UI).
