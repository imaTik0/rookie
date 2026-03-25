import { createRoute } from "@hono/zod-openapi";
import {
    CreateProjectSchema,
    CreateProjectFromUrlSchema,
    DeleteProjectResponseSchema,
    PaginatedProjectsResponseSchema,
    ParamsSchema,
    ProjectSchema,
    UpdateProjectSchema,
} from "./ProjectSchema.ts";
import { FileIDsSchema } from "../file/FileSchema.ts";
import { ErrorSchema, PaginationQuerySchema } from "../CommonSchema.ts";

const CreateProjectRoute = createRoute({
    method: "post",
    path: "/projects",
    tags: ["Projects"],
    summary: "Create a new project",
    request: {
        body: {
            content: { "application/json": { schema: CreateProjectSchema } },
            required: true,
        },
    },
    responses: {
        201: {
            description: "Project created",
            content: { "application/json": { schema: ProjectSchema } },
        },
        400: {
            description: "Bad Request",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

const GetProjectRoute = createRoute({
    method: "get",
    path: "/projects/{id}",
    tags: ["Projects"],
    summary: "Get a single project by ID",
    request: {
        params: ParamsSchema,
    },
    responses: {
        200: {
            description: "Project found",
            content: { "application/json": { schema: ProjectSchema } },
        },
        404: {
            description: "Project not found",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

const ListProjectsRoute = createRoute({
    method: "get",
    path: "/projects",
    tags: ["Projects"],
    summary: "List all projects (paginated)",
    request: {
        query: PaginationQuerySchema,
    },
    responses: {
        200: {
            description: "A paginated list of projects",
            content: { "application/json": { schema: PaginatedProjectsResponseSchema } },
        },
    },
});

const UpdateProjectRoute = createRoute({
    method: "patch",
    path: "/projects/{id}",
    tags: ["Projects"],
    summary: "Update a project's details",
    request: {
        params: ParamsSchema,
        body: {
            content: { "application/json": { schema: UpdateProjectSchema } },
            required: true,
        },
    },
    responses: {
        200: {
            description: "Project updated",
            content: { "application/json": { schema: ProjectSchema } },
        },
        400: {
            description: "Bad Request",
            content: { "application/json": { schema: ErrorSchema } },
        },
        404: {
            description: "Project not found",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

const DeleteProjectRoute = createRoute({
    method: "delete",
    path: "/projects/{id}",
    tags: ["Projects"],
    summary: "Delete a project",
    request: {
        params: ParamsSchema,
    },
    responses: {
        200: {
            description: "Project deleted",
            content: { "application/json": { schema: DeleteProjectResponseSchema } },
        },
        404: {
            description: "Project not found",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

const AddFilesToProjectRoute = createRoute({
    method: "post",
    path: "/projects/{id}/files",
    tags: ["Projects"],
    summary: "Associate files with a project by ID",
    request: {
        params: ParamsSchema,
        body: {
            content: { "application/json": { schema: FileIDsSchema } },
            required: true,
        },
    },
    responses: {
        200: {
            description: "Files associated",
            content: { "application/json": { schema: ProjectSchema } },
        },
        400: {
            description: "Bad Request (e.g., invalid file IDs)",
            content: { "application/json": { schema: ErrorSchema } },
        },
        404: {
            description: "Project or File(s) not found",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});

const RemoveFilesFromProjectRoute = createRoute({
    method: "delete",
    path: "/projects/{id}/files",
    tags: ["Projects"],
    summary: "Disassociate files from a project by ID",
    request: {
        params: ParamsSchema,
        body: {
            content: { "application/json": { schema: FileIDsSchema } },
            required: true,
        },
    },
    responses: {
        200: {
            description: "Files disassociated",
            content: { "application/json": { schema: ProjectSchema } },
        },
        400: {
            description: "Bad Request",
            content: { "application/json": { schema: ErrorSchema } },
        },
        404: {
            description: "Project not found",
            content: { "application/json": { schema: ErrorSchema } },
        },
    },
});
const CreateProjectFromUrlRoute = createRoute({
    method: "post",
    path: "/projects/from-url",
    tags: ["Projects"],
    summary: "Create a new project from a documentation URL",
    request: {
        body: {
            content: { "application/json": { schema: CreateProjectFromUrlSchema } },
            required: true,
        },
    },
    responses: {
        201: {
            description: "Project created",
            content: { "application/json": { schema: ProjectSchema } },
        },
        400: {
            description: "Bad Request",
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
