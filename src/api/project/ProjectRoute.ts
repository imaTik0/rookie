import { createRoute } from "@hono/zod-openapi";
import {
    CreateProjectFromUrlSchema,
    CreateProjectSchema,
    DeleteProjectResponseSchema,
    PaginatedProjectsResponseSchema,
    ParamsSchema,
    ProjectSchema,
    UpdateProjectSchema,
} from "./ProjectSchema.ts";
import { FileIDsSchema } from "../file/FileSchema.ts";
import { JobSchema } from "../job/JobSchema.ts";
import { ErrorSchema, PaginationQuerySchema } from "../CommonSchema.ts";

const CreateProjectRoute = createRoute({
    method: "post",
    path: "/projects",
    tags: ["Projects"],
    summary: "Create a new project",
    description: `Creates a project — the top-level container that groups documentation files and \
owns a dedicated vector collection used for retrieval.

If \`fileIds\` are supplied, each referenced file is **chunked** (structure-aware: \
heading boundaries respected, fenced code blocks kept intact) and **indexed** into the \
project's Qdrant collection with both BM25 sparse and dense embeddings. Files must already \
exist (upload them first via \`POST /files/upload\`); unknown IDs are rejected.

To create a project directly from a live documentation website instead, use \
\`POST /projects/from-url\`.`,
    request: {
        body: {
            content: { "application/json": { schema: CreateProjectSchema } },
            required: true,
        },
    },
    responses: {
        201: {
            description: "Project created and any supplied files indexed.",
            content: { "application/json": { schema: ProjectSchema } },
        },
        400: {
            description:
                "Invalid request — e.g. the project name is too short or one or more `fileIds` do not exist.",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

const GetProjectRoute = createRoute({
    method: "get",
    path: "/projects/{id}",
    tags: ["Projects"],
    summary: "Get a single project by ID",
    description:
        `Fetches one project by its identifier, including the metadata of every associated \
documentation file (filename, MIME type, size, timestamps). File contents are not returned — \
use the Files API to download raw bytes.`,
    request: {
        params: ParamsSchema,
    },
    responses: {
        200: {
            description: "Project found; returns the project with populated file metadata.",
            content: { "application/json": { schema: ProjectSchema } },
        },
        404: {
            description: "No project exists with the given ID.",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

const ListProjectsRoute = createRoute({
    method: "get",
    path: "/projects",
    tags: ["Projects"],
    summary: "List all projects (paginated)",
    description:
        `Returns a paginated list of projects ordered by the repository default, each with its \
populated file metadata. Control the page window with the \`page\` and \`limit\` query parameters; \
the response \`meta\` block reports total counts for building pagination controls.`,
    request: {
        query: PaginationQuerySchema,
    },
    responses: {
        200: {
            description: "A paginated list of projects plus pagination metadata.",
            content: { "application/json": { schema: PaginatedProjectsResponseSchema } },
        },
    },
});

const UpdateProjectRoute = createRoute({
    method: "patch",
    path: "/projects/{id}",
    tags: ["Projects"],
    summary: "Update a project's details",
    description: `Partially updates a project. Any omitted field is left unchanged.

- **\`projectName\`** — renames the project.
- **\`fileIds\`** — **replaces** the project's file set and reconciles the vector index \
accordingly: files no longer present have their vectors deleted from the Qdrant collection, \
and newly added files are chunked and indexed. Files already present are left untouched (no \
re-indexing). Passing an empty array detaches all files and clears their vectors.

To add or remove individual files without restating the whole set, prefer the dedicated \
\`POST\` / \`DELETE\` \`/projects/{id}/files\` endpoints.`,
    request: {
        params: ParamsSchema,
        body: {
            content: { "application/json": { schema: UpdateProjectSchema } },
            required: true,
        },
    },
    responses: {
        200: {
            description: "Project updated; returns the project with its current file set.",
            content: { "application/json": { schema: ProjectSchema } },
        },
        400: {
            description: "Invalid request — e.g. an invalid name or unknown `fileIds`.",
            content: { "application/json": { schema: ErrorSchema } },
        },
        404: {
            description: "No project exists with the given ID.",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

const DeleteProjectRoute = createRoute({
    method: "delete",
    path: "/projects/{id}",
    tags: ["Projects"],
    summary: "Delete a project",
    description: `Permanently deletes a project and **drops its entire Qdrant vector collection** \
(all indexed chunks for the project). The underlying uploaded files are **not** deleted from \
file storage — they remain available to other projects and can be removed separately via the \
Files API. This operation cannot be undone.`,
    request: {
        params: ParamsSchema,
    },
    responses: {
        200: {
            description: "Project deleted and its vector collection dropped.",
            content: { "application/json": { schema: DeleteProjectResponseSchema } },
        },
        404: {
            description: "No project exists with the given ID.",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

const AddFilesToProjectRoute = createRoute({
    method: "post",
    path: "/projects/{id}/files",
    tags: ["Projects"],
    summary: "Associate (and index) files with a project",
    description:
        `Associates one or more already-uploaded files with the project and **indexes only the \
files that are not already part of it** (preventing duplicate vectors). Each newly added file is \
chunked and stored in the project's Qdrant collection (BM25 sparse + dense).

All supplied file IDs must exist. If indexing fails for one or more files, the request returns \
\`400\` with the per-file error details; files that indexed successfully before the failure \
remain indexed.`,
    request: {
        params: ParamsSchema,
        body: {
            content: { "application/json": { schema: FileIDsSchema } },
            required: true,
        },
    },
    responses: {
        200: {
            description:
                "Files associated and newly added ones indexed; returns the updated project.",
            content: { "application/json": { schema: ProjectSchema } },
        },
        400: {
            description:
                "Invalid file IDs, or indexing failed for one or more files (details in message).",
            content: { "application/json": { schema: ErrorSchema } },
        },
        404: {
            description: "No project exists with the given ID.",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

const RemoveFilesFromProjectRoute = createRoute({
    method: "delete",
    path: "/projects/{id}/files",
    tags: ["Projects"],
    summary: "Disassociate (and de-index) files from a project",
    description:
        `Removes the association between the given files and the project, and **deletes those \
files' vectors** from the project's Qdrant collection so they no longer surface in retrieval. \
The files themselves are not deleted from storage and remain usable by other projects. File IDs \
that are not associated with the project are ignored.`,
    request: {
        params: ParamsSchema,
        body: {
            content: { "application/json": { schema: FileIDsSchema } },
            required: true,
        },
    },
    responses: {
        200: {
            description:
                "Files disassociated and their vectors removed; returns the updated project.",
            content: { "application/json": { schema: ProjectSchema } },
        },
        400: {
            description: "Invalid request body.",
            content: { "application/json": { schema: ErrorSchema } },
        },
        404: {
            description: "No project exists with the given ID.",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

const CreateProjectFromUrlRoute = createRoute({
    method: "post",
    path: "/projects/from-url",
    tags: ["Projects"],
    summary: "Create a project by crawling a documentation URL",
    description:
        `Creates a project directly from a live documentation website — no manual file upload \
required.

Ingestion is **standards-first**: if the origin publishes an \`llms-full.txt\`, that single \
Markdown document is used directly. Otherwise the crawler walks up to \`maxPages\` same-origin \
pages, extracting the main content with Mozilla Readability (stripping navigation, sidebars, and \
footers) and converting it to clean Markdown with Turndown (tables and code blocks preserved). \
Each page is stored as a Markdown file and indexed (BM25 sparse + dense) just like an uploaded file.

JavaScript-rendered pages (e.g. a Swagger UI shell) are detected and skipped; if the start URL \
itself is such a page, the job fails with that reason (a hint to use the raw OpenAPI/Swagger \
JSON instead), as it does when no pages could be crawled.

Crawling can take minutes, so this runs as a **background job**: the endpoint returns immediately \
with a job. Poll \`GET /jobs/{jobId}\`; on \`SUCCEEDED\` the job's \`result.projectId\` is the new \
project. Cancel an in-progress crawl with \`DELETE /jobs/{jobId}\`.`,
    request: {
        body: {
            content: { "application/json": { schema: CreateProjectFromUrlSchema } },
            required: true,
        },
    },
    responses: {
        202: {
            description: "Crawl accepted; returns the job to poll (`result.projectId` on success).",
            content: { "application/json": { schema: JobSchema } },
        },
        400: {
            description: "Invalid request body.",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

export const ProjectRoutes = {
    CreateProjectRoute,
    CreateProjectFromUrlRoute,
    GetProjectRoute,
    ListProjectsRoute,
    UpdateProjectRoute,
    DeleteProjectRoute,
    AddFilesToProjectRoute,
    RemoveFilesFromProjectRoute,
};
