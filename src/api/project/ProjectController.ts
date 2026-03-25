import type { RouteHandler } from "@hono/zod-openapi";
import { Controller, Delete, Get, Patch, Post } from "../Decorator.ts";
import { ProjectService } from "../../service/ProjectService.ts";
import * as types from "../../types/index.ts";
import { ProjectRoutes } from "./ProjectRoute.ts";

@Controller("/projects")
export class ProjectController {
    constructor(
        private projectService: ProjectService,
    ) {}

    @Post(ProjectRoutes.CreateProjectRoute)
    createProject: RouteHandler<typeof ProjectRoutes.CreateProjectRoute> = async (c) => {
        const createProjectDto = c.req.valid("json");
        try {
            const newProject = await this.projectService.createProject(
                createProjectDto.projectName,
                createProjectDto.fileIds as types.file.FileId[],
            );
            return c.json(newProject, 201);
        } catch (error) {
            const err = error as { message?: string };
            return c.json({ code: 400, message: err?.message || "Unknown error" }, 400);
        }
    };

    @Post(ProjectRoutes.CreateProjectFromUrlRoute)
    createProjectFromUrl: RouteHandler<typeof ProjectRoutes.CreateProjectFromUrlRoute> = async (c) => {
        const { projectName, url, maxPages } = c.req.valid("json");
        try {
            const newProject = await this.projectService.createProjectFromUrl(projectName, url, maxPages);
            return c.json(newProject, 201);
        } catch (error) {
            const err = error as { message?: string };
            return c.json({ code: 400, message: err?.message || "Unknown error" }, 400);
        }
    };

    @Get(ProjectRoutes.GetProjectRoute)
    getProject: RouteHandler<typeof ProjectRoutes.GetProjectRoute> = async (c) => {
        const { id } = c.req.valid("param");
        const project = await this.projectService.getProjectById(id as types.project.ProjectId);
        if (!project) {
            return c.json({ code: 404, message: "Project not found" }, 404);
        }
        return c.json(project, 200);
    };

    @Get(ProjectRoutes.ListProjectsRoute)
    listProjects: RouteHandler<typeof ProjectRoutes.ListProjectsRoute> = async (c) => {
        const { page, limit } = c.req.valid("query");
        const response = await this.projectService.listProjects({ page, limit });
        return c.json(response, 200);
    };

    @Patch(ProjectRoutes.UpdateProjectRoute)
    updateProject: RouteHandler<typeof ProjectRoutes.UpdateProjectRoute> = async (c) => {
        const { id } = c.req.valid("param");
        const updateProjectDto = c.req.valid("json");
        try {
            const updatedProject = await this.projectService.updateProject(
                id as types.project.ProjectId,
                {
                    projectName: updateProjectDto.projectName,
                    fileIds: updateProjectDto.fileIds as types.file.FileId[],
                },
            );
            if (!updatedProject) {
                return c.json({ code: 404, message: "Project not found" }, 404);
            }
            return c.json(updatedProject, 200);
        } catch (error) {
            const err = error as { message?: string };
            return c.json({ code: 400, message: err?.message || "Unknown error" }, 400);
        }
    };

    @Delete(ProjectRoutes.DeleteProjectRoute)
    deleteProject: RouteHandler<typeof ProjectRoutes.DeleteProjectRoute> = async (c) => {
        const { id } = c.req.valid("param");

        const success = await this.projectService.deleteProject(id as types.project.ProjectId);

        if (!success) {
            return c.json({ code: 404, message: "Project not found" }, 404);
        }

        const response = {
            id: id,
            message: "Project deleted",
        };

        return c.json(response, 200);
    };

    @Post(ProjectRoutes.AddFilesToProjectRoute)
    addFilesToProject: RouteHandler<typeof ProjectRoutes.AddFilesToProjectRoute> = async (c) => {
        const { id } = c.req.valid("param");
        const { fileIds } = c.req.valid("json");
        try {
            const updatedProject = await this.projectService.addFilesToProject(
                id as types.project.ProjectId,
                fileIds as types.file.FileId[],
            );
            if (!updatedProject) {
                return c.json({ code: 404, message: "Project not found" }, 404);
            }
            return c.json(updatedProject, 200);
        } catch (error) {
            const err = error as { message?: string };
            return c.json({ code: 400, message: err?.message || "Unknown error" }, 400);
        }
    };

    @Delete(ProjectRoutes.RemoveFilesFromProjectRoute)
    removeFilesFromProject: RouteHandler<typeof ProjectRoutes.RemoveFilesFromProjectRoute> = async (
        c,
    ) => {
        const { id } = c.req.valid("param");
        const { fileIds } = c.req.valid("json");
        const updatedProject = await this.projectService.removeFilesFromProject(
            id as types.project.ProjectId,
            fileIds as types.file.FileId[],
        );
        if (!updatedProject) {
            return c.json({ code: 404, message: "Project not found" }, 404);
        }
        return c.json(updatedProject, 200);
    };
}
