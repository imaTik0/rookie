# Rookie Frontend

Dark dev-tool console for the Rookie backend (React + Vite + Tailwind v4 + shadcn-style components), living as a Deno workspace member of the monorepo.

## Run

From the repo root (starts backend + frontend together):

```sh
deno task dev      # backend watch + vite dev server
deno task prod     # backend start + vite preview
```

Or just the frontend:

```sh
cd frontend
deno install       # first time, installs npm deps into node_modules
deno task dev      # http://localhost:5173
```

The dev server proxies `/api/*` to the backend (`http://localhost:3000` by default; override with `ROOKIE_API_URL`). For a non-proxied deployment set `VITE_API_URL` at build time.

## Pages

- **Reports** — paginated, filterable list (project / suite / status / type) and a rich viewer: step timeline with generated code, container logs, failure analysis (gap classification, suggested docs fixes, fragment diffs), and a dedicated master-plan view (pass-rate ring, failure taxonomy, goal breakdown, documentation gaps, recommendations).
- **Projects** — CRUD, create-from-URL (background crawl job), file attach/detach with vector reindexing.
- **Test Suites** — create/edit both modes, execute as background job.
- **Jobs** — live-polling list with progress, cancel, links to resulting reports/projects.
- **Files** — upload (single/multi), download, delete.
- **Master Planner** — runs `/planner/run` and renders the NDJSON stream live: goal checklist, event feed, link to the final report.

## Structure

```
src/
  lib/          api client, types mirrored from backend zod schemas, formatters
  components/
    ui/         shadcn-style primitives (button, card, dialog, tabs, ...)
    shared/     status badges, code blocks, pagination, collapsible, markdown
  pages/        one file per route
```
