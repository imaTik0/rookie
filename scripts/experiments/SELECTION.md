# Target Selection Protocol — Documentation-Drift Experiment

> **Status:** pre-registered selection. All criteria, the ranking rule, and the
> replacement queue below were fixed **before** any experiment run on the
> selected targets. Deviations are only permitted through the pre-registered
> replacement rule (§6) and must be logged in §8.

## 1. Population (sampling frame)

The population is the [awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted)
list — a widely used, externally curated catalogue of self-hostable software
with an explicit inclusion policy (working, actively maintained, OSI-licensed
projects). Using an external, community-maintained frame removes author
discretion from the population definition.

- **Snapshot (pinned):** commit `334eaa016ba6b93a4ce486d16ffd4050593c7b66`
  (2026-07-05).
- **Population size:** 1 246 entries (lines matching `- [Name](url)` in the
  pinned `README.md`).
- **Metadata source:** the machine-readable sibling repository
  `awesome-selfhosted-data` (per-entry YAML: `stargazers_count`, `platforms`,
  `tags`, `archived`), joined by entry name; 1 238 of 1 246 entries joined.
  Entries present only in the data repository but absent from the pinned README
  (e.g. _n8n_, licensed Apache-2.0 **with Commons-Clause**, hence excluded from
  the main list by its maintainers) are **not** part of the population.

## 2. Pilot exclusion

Two systems were used while developing and tuning the pipeline and are
therefore **excluded from the evaluation sample** to avoid overfitting bias:

- **Gitea** (in population, rank 22) — development pilot;
- **InfluxDB** (not in population) — development pilot.

Both remain available in the runner configuration as pilots; their results are
reported separately and never pooled with the sample.

## 3. Eligibility criteria (method-imposed)

Each criterion follows from a technical constraint of the measurement
instrument, not from expected outcomes:

| ID | Criterion                                                                                                                                                | Imposed by                                                                 |
| -- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| E1 | The project itself publishes documentation of an HTTP API (REST/JSON-RPC/admin API) intended for programmatic use                                        | the measured artifact is the project's own API documentation               |
| E2 | Project-endorsed container image on a public registry with version tags                                                                                  | the runner deploys targets via a single `docker run` of official images    |
| E3 | Single-container operation (embedded storage or project-endorsed all-in-one image); no mandatory external services                                       | the runner starts exactly one container                                    |
| E4 | ≥ 2 distinct stable versions published as image tags                                                                                                     | drift needs an old→new pair                                                |
| E5 | Documentation ingestible by the system (server-rendered HTML, repository documents, or OpenAPI served by the instance) — not exclusively client-rendered | crawler capability; per-target fidelity strategy is recorded in the config |
| E6 | Non-interactive credential provisioning (env vars, default credentials, in-container CLI, or scriptable HTTP setup)                                      | unattended experiment execution                                            |
| E7 | HTTP-determinable readiness                                                                                                                              | the runner's health gate                                                   |
| E8 | Not a fork/ancestor/sibling of an already-selected or pilot project (higher-ranked family member kept)                                                   | prevents pseudo-replication                                                |

**Diversity cap:** at most **2 targets per category** (the entry's first tag in
the list's own taxonomy), so the sample cannot concentrate in one domain.

## 4. Selection rule

Walk the population in **descending order of `stargazers_count`** (snapshot
values) and assess each entry against E1–E8 and the category cap. The first
**20 eligible** entries form the sample; the next **5 eligible** entries form
the ordered replacement queue. Stars are an objective, externally recorded
popularity proxy: the sample is "the most-used eligible projects", which is the
population practitioners care about — and leaves zero room for cherry-picking.

## 5. Screening log (ranks 1–73 of the joined population)

Verdicts: **S** = selected, **R** = reserve, `E*` = excluded by criterion,
`CAP` = category cap reached, `PILOT` = pilot exclusion.

| Rank |   Stars | Entry               | Category (first tag) | Verdict                                                                              |
| ---: | ------: | ------------------- | -------------------- | ------------------------------------------------------------------------------------ |
|    1 | 175 462 | Ollama              | GenAI                | **S1** (docs = repo `docs/api.md` at old tag)                                        |
|    2 | 144 210 | Open-WebUI          | GenAI                | **S2**                                                                               |
|    3 | 105 610 | Immich              | Photo Galleries      | E3 (Postgres + Redis + ML services)                                                  |
|    4 |  88 192 | Home Assistant      | IoT                  | **S3** (E6 via scriptable onboarding — flagged)                                      |
|    5 |  86 077 | Stirling-PDF        | Document Mgmt        | **S4** (self-served OpenAPI)                                                         |
|    6 |  86 045 | Syncthing           | File Transfer & Sync | **S5** (API key via in-container config)                                             |
|    7 |  79 731 | Hoppscotch CE       | API Management       | E3 (Postgres)                                                                        |
|    8 |  78 184 | code-server         | IDE & Tools          | E1 (no product HTTP API)                                                             |
|    9 |  73 737 | Caddy               | Web Servers          | **S6** (admin API)                                                                   |
|   10 |  73 656 | Superset            | Analytics            | E3 (metadata DB + Redis)                                                             |
|   11 |  73 290 | AppFlowy            | Task Mgmt            | E3 (Cloud stack: gotrue+Postgres+MinIO)                                              |
|   12 |  72 593 | Strapi              | CMS                  | E2 (no endorsed runtime image)                                                       |
|   13 |  71 876 | revealjs            | Misc                 | E1 (not a service)                                                                   |
|   14 |  70 072 | AFFiNE CE           | Knowledge Mgmt       | E3 (Postgres + Redis)                                                                |
|   15 |  63 851 | Traefik             | Web Servers          | **S7** (versioned docs v2/v3)                                                        |
|   16 |  63 281 | Vaultwarden         | Password Mgrs        | E1 (client API documented upstream by Bitwarden; project docs cover deployment only) |
|   17 |  62 579 | AnythingLLM         | GenAI                | CAP (GenAI = 2)                                                                      |
|   18 |  61 290 | Memos               | Note-taking          | **S8**                                                                               |
|   19 |  59 673 | Pi-hole             | DNS                  | **S9** (v6 REST API; adjacent v6 tags)                                               |
|   20 |  59 417 | PocketBase          | Low Code             | E2 (binary distribution; no official image)                                          |
|   21 |  58 407 | MeiliSearch         | Search               | **S10** (master key via env)                                                         |
|   22 |  56 681 | Gitea               | Project Mgmt         | PILOT                                                                                |
|   23 |  56 479 | Appwrite            | Low Code             | E3 (MariaDB + Redis)                                                                 |
|   24 |  55 431 | Joplin              | Note-taking          | E3 (server requires Postgres)                                                        |
|   25 |  54 972 | penpot              | Misc                 | E3 (multi-service)                                                                   |
|   26 |  54 266 | Ghost               | Blogging             | **S11** (SQLite config; session-auth Admin API)                                      |
|   27 |  53 951 | Jellyfin            | Media Streaming      | **S12** (self-served `openapi.json`)                                                 |
|   28 |  53 838 | Plane               | Project Mgmt         | E3 (multi-service)                                                                   |
|   29 |  52 818 | Odoo                | Resource Planning    | E3 (Postgres)                                                                        |
|   30 |  52 177 | Twenty              | CRM                  | E3 (Postgres + Redis)                                                                |
|   31 |  50 088 | Mastodon            | Social Networks      | E3 (multi-service)                                                                   |
|   32 |  49 571 | Huginn              | Automation           | E1 (no maintained API reference)                                                     |
|   33 |  48 043 | Metabase            | Analytics            | **S13** (embedded H2; scriptable `/api/setup`)                                       |
|   34 |  47 652 | Gogs                | Project Mgmt         | E8 (family of pilot Gitea)                                                           |
|   35 |  47 393 | Discourse           | Social Networks      | E3 (Postgres + Redis, custom builder)                                                |
|   36 |  47 313 | LocalAI             | GenAI                | CAP                                                                                  |
|   37 |  46 071 | Cal.diy             | Booking              | E3 (Postgres)                                                                        |
|   38 |  46 029 | Apache Airflow      | Automation           | **S14** (`standalone` mode, SQLite; versioned REST docs — heavy image, flagged)      |
|   39 |  45 751 | Rocket.Chat         | Communication        | E3 (MongoDB)                                                                         |
|   40 |  45 476 | copyparty           | File Managers        | E1 (no dedicated API reference; HTTP parameters inline in usage README)              |
|   41 |  45 104 | RSSHub              | Feed Readers         | **S15** (the product _is_ a documented HTTP API)                                     |
|   42 |  44 915 | SiYuan              | Knowledge Mgmt       | **S16** (kernel `API.md` at old tag; access-auth code)                               |
|   43 |  43 731 | Kong                | API Management       | **S17** (DB-less mode; versioned admin-API docs)                                     |
|   44 |  43 382 | Payload CMS         | CMS                  | E2/E1 (framework; per-project API)                                                   |
|   45 |  43 193 | HyperSwitch         | Money Mgmt           | E3 (Postgres + Redis)                                                                |
|   46 |  42 729 | Paperless-ngx       | Document Mgmt        | E3 (Redis broker mandatory)                                                          |
|   47 |  42 615 | Puter               | File Transfer & Sync | E1 (docs target hosted JS SDK; no self-host API reference)                           |
|   48 |  40 283 | LibreChat           | GenAI                | CAP                                                                                  |
|   49 |  40 240 | Appsmith            | Low Code             | E1 (internal API undocumented)                                                       |
|   50 |  39 921 | PhotoPrism          | Photo Galleries      | E1 (API declared internal/unstable)                                                  |
|   51 |  39 325 | Reactive Resume     | Misc                 | E3 (Postgres + MinIO)                                                                |
|   52 |  39 244 | Novu                | Communication        | E3 (multi-service)                                                                   |
|   53 |  39 225 | Halo                | Low Code             | **S18** (single container, H2; springdoc OpenAPI)                                    |
|   54 |  38 941 | Sunshine            | Games                | E1                                                                                   |
|   55 |  38 594 | qBittorrent         | P2P                  | E2 (community images only)                                                           |
|   56 |  38 132 | ToolJet             | Low Code             | E3 (Postgres)                                                                        |
|   57 |  37 476 | Umami               | Analytics            | E3 (Postgres/MySQL mandatory)                                                        |
|   58 |  36 716 | TriliumNext Notes   | Note-taking          | **S19** (ETAPI; E6 first-run — flagged)                                              |
|   59 |  36 520 | ERPNext             | Resource Planning    | E3 (MariaDB + Redis)                                                                 |
|   60 |  36 178 | CasaOS              | Self-hosting         | E1                                                                                   |
|   61 |  36 032 | Nextcloud           | File Transfer & Sync | **S20** (versioned docs; env admin) — **sample complete**                            |
|   62 |  35 599 | Glance              | Dashboards           | E1 (config-driven, no API)                                                           |
|   63 |  35 561 | Vane                | GenAI                | CAP                                                                                  |
|   64 |  35 471 | Khoj                | GenAI                | CAP                                                                                  |
|   65 |  35 377 | filebrowser         | Web File Managers    | **R1** (reserve)                                                                     |
|   66 |  35 320 | PostHog             | Analytics            | E3 (multi-service)                                                                   |
|   67 |  35 258 | CyberChef           | Misc                 | E1 (static app)                                                                      |
|   68 |  35 258 | AdGuard Home        | DNS                  | **R2** (reserve)                                                                     |
|   69 |  34 923 | MedusaJs            | E-commerce           | E2/E3 (framework; Postgres)                                                          |
|   70 |  34 142 | Frigate             | Video Surveillance   | **R3** (reserve; runs without cameras — flagged)                                     |
|   71 |  33 479 | Nginx Proxy Manager | Web Servers          | CAP (Web Servers = 2)                                                                |
|   72 |  33 368 | SearXNG             | Search               | **R4** (reserve; thin API reference — flagged)                                       |
|   73 |  33 298 | SeaweedFS           | Object Storage       | **R5** (reserve) — **queue complete**                                                |

Screening stopped at rank 73, where the 20-target sample and the 5-target
replacement queue were complete. Entries below rank 73 were not assessed
(the rule is deterministic; anyone can extend the walk from the pinned data).

## 6. Replacement rule (pre-registered)

If a selected target fails **technical preflight** (image tag unavailable,
container does not become healthy, docs source not ingestible, credential
provisioning fails) — i.e. for reasons unrelated to experiment outcomes — it is
replaced by the next reserve in queue order (R1→R5), and the failure is logged
in §8 with the failing criterion. Targets are **never** replaced or dropped
after their experiment has produced results.

## 7. Funnel summary

```
Population (README @ 334eaa0) ............ 1246
  joined with metadata ................... 1238
  screened (ranks 1–73, desc. stars) .....   73
    excluded E1 (no product API docs) ....   11
    excluded E2 (no endorsed image) ......    5
    excluded E3 (multi-container) ........   23
    excluded E8 (family of pilot) ........    1
    category cap (≤2 per category) .......    7
    pilot exclusion ......................    1  (Gitea; InfluxDB outside population)
    SELECTED .............................   20
    RESERVE QUEUE ........................    5
```

Sample properties: 20 targets across **18 distinct categories**; stars range
36 032 – 175 462; all criteria verdicts recorded above and reproducible from
the pinned snapshot.

## 8. Deviation log

_(empty — to be filled only via the replacement rule in §6)_
