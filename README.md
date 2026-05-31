<div align="center">
  <img src="rookielogo.png" alt="Rookie API Logo" width="200"/>
</div>

# Rookie API

Rookie API is an AI-driven platform designed to evaluate and validate the quality of technical documentation. By treating Large Language Models (LLMs) as "Virtual Developers," the system tests whether your API documentation is clear, accurate, and complete enough for an automated agent to understand and interact with your services.

The primary goal is not just to automate tests, but to use AI as a litmus test for documentation: if a "Senior Virtual Engineer" can't write a working test based on your docs, your documentation needs improvement.

## Key Features

- **Documentation Quality Testing**: Uses LLMs as surrogate developers to verify if documentation is sufficient for real-world integration.
- **AI-Native Test Generation**: Test scenarios are dynamically planned and coded by LLMs by reading your provided API specifications.
- **Isolated Execution**: All AI-generated code is executed within secure, ephemeral Docker containers, ensuring no side effects on the host system.
- **RAG-based Diagnosis**: If a test fails because of a documentation gap, the system uses Retrieval-Augmented Generation (RAG) to identify the missing or confusing information.
- **Local Embeddings**: Uses `@xenova/transformers` for local embedding generation, keeping your sensitive documentation on-premise.

## Tech Stack

- **Runtime**: [Deno](https://deno.land/)
- **Web Framework**: [Hono](https://hono.dev/) (with `zod-openapi`)
- **Databases**:
  - **MongoDB**: Stores project metadata, file definitions, test suites, and execution reports.
  - **Qdrant**: Vector database for storing documentation embeddings used in RAG.
- **AI/ML**:
  - **OpenAI (GPT-4/o1)**: For planning test steps and generating JavaScript execution code.
  - **Xenova Transformers**: For local text embedding generation.
- **Isolation**: **Docker** for running untrusted, AI-generated test scripts.

## Getting Started

### Prerequisites

- [Deno](https://deno.land/) (latest version)
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

The application can be configured via environment variables or a configuration file.

| Variable                       | Description               | Default                     |
| ------------------------------ | ------------------------- | --------------------------- |
| `ROOKIE_HOST`                  | Server host               | `localhost`                 |
| `ROOKIE_PORT`                  | Server port               | `3000`                      |
| `ROOKIE_MONGO_DB_URL`          | MongoDB connection string | `mongodb://localhost:27017` |
| `ROOKIE_MONGO_DB_NAME`         | MongoDB database name     | `rookie_db`                 |
| `ROOKIE_QDRANT_HOST`           | Qdrant host               | `127.0.0.1`                 |
| `ROOKIE_QDRANT_PORT`           | Qdrant port               | `6333`                      |
| `ROOKIE_OPENAI_KEY`            | LLM API key (`ROOKIE_OPEAN_AI_KEY` still accepted) | (Required) |
| `ROOKIE_OPENAI_BASE_URL`       | LLM endpoint (OpenAI-compatible; set for Ollama/vLLM) | OpenAI |
| `ROOKIE_OPENAI_MODEL_NAME`     | Chat model                | `gpt-4o-mini`               |
| `ROOKIE_EMBEDDING_MODEL`       | Model for embeddings      | `nomic-embed-text`          |
| `ROOKIE_EMBEDDING_VECTOR_SIZE` | Vector size for the model | `768`                       |
| `ROOKIE_EMBEDDING_BASE_URL`    | Embeddings endpoint (OpenAI-compatible) | OpenAI |

### Quality / determinism

| Variable                        | Description                                             | Default       |
| ------------------------------- | ------------------------------------------------------- | ------------- |
| `ROOKIE_LLM_TEMPERATURE`        | Sampling temperature for all calls                      | `0.2`         |
| `ROOKIE_LLM_SEED`               | Optional integer seed (ignored if unsupported)          | (unset)       |
| `ROOKIE_STRUCTURED_OUTPUT_MODE` | `json_schema` \| `json_object` \| `text`                | `json_object` |
| `ROOKIE_LLM_MAX_REPAIR_ATTEMPTS`| Repair retries when JSON fails zod validation           | `1`           |
| `ROOKIE_LLM_MAX_RETRIES`        | Backoff retries on transient 429/5xx/network errors     | `3`           |
| `ROOKIE_LLM_RETRY_BASE_MS`      | Base backoff delay (exponential + jitter)               | `500`         |
| `ROOKIE_MAX_CONTEXT_TOKENS`     | Token budget before non-destructive loop compaction     | `12000`       |
| `ROOKIE_CLASSIFIER_VOTES`       | Self-consistency votes in the failure classifier        | `3`           |
| `ROOKIE_RERANKER_MODE`          | `off` \| `llm` \| `api` (cross-encoder rerank)          | `off`         |
| `ROOKIE_BM25_K1` / `_B` / `_AVG_LEN` | BM25 sparse-vector parameters                      | `1.5/0.75/256`|

> `json_schema` mode now derives a strict JSON Schema from the zod schemas
> automatically (zod v4 `toJSONSchema`). If a server rejects it, Rookie degrades
> to `json_object` at runtime — so it is safe to try on capable models and
> harmless on small ones.

### Sandbox (untrusted-code execution)

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

### Running the App (Backend)

```bash
# Start the production server
deno task start

# Start in development mode with hot-reload and pretty logging
deno task watch
```

### Running the Frontend (Agentic RAG Monitor)

The project includes a modern React frontend Built with Vite to monitor the LLM execution in real-time.

```bash
cd frontend
npm install
npm run dev
```

The frontend will be available at `http://localhost:5173`. You can enter a Test Suite ID and watch the Agentic RAG execute with token-by-token streaming.

## Workflow

1. **Upload Documentation**: Upload API specifications or text descriptions to a project.
2. **Indexing**: The system processes files, generates embeddings, and stores them in Qdrant.
3. **Define Test Suite**: Specify the testing goals and initial context (e.g., auth tokens).
4. **Execution**:
   - LLM analyzes the documentation and plans a sequence of API calls.
   - Each step is converted into JavaScript code.
   - Code runs in a Docker container; state (`ctx`) is passed between steps.
5. **Reporting**: Review detailed execution logs and results.

## API Documentation

Once the server is running, you can access the interactive API documentation at:
`http://localhost:3000/reference` (Scalar) or `http://localhost:3000/ui` (Swagger UI).
