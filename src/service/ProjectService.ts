import {
    CreateProjectSchema,
    PaginatedProjectsResponseSchema,
    UpdateProjectSchema,
} from "../api/project/ProjectSchema.ts";
import * as types from "../types/index.ts";
import { z } from "zod";
import { FileRepository } from "./FileRepository.ts";
import { ProjectRepository } from "./ProjectRepository.ts";

type CreateProjectDto = z.infer<typeof CreateProjectSchema>;
type UpdateProjectDto = z.infer<typeof UpdateProjectSchema>;

export class ProjectService {
    constructor(
        private projectRepository: ProjectRepository,
        private fileRepository: FileRepository,
    ) {}

    private async validateFileIds(fileIds: types.file.FileId[]): Promise<void> {
        if (!fileIds || fileIds.length === 0) {
            return;
        }
        const existingFiles = await this.fileRepository.getMetadataByIds(fileIds);
        if (existingFiles.length !== fileIds.length) {
            const foundIds = new Set(existingFiles.map((f) => f._id));
            const missing = fileIds.filter((id) => !foundIds.has(id));
            throw new Error(`Invalid file IDs: ${missing.join(", ")}`);
        }
    }

    async createProject(dto: CreateProjectDto): Promise<any> {
        if (dto.fileIds) {
            await this.validateFileIds(dto.fileIds as types.file.FileId[]);
        }
        const newProject = await this.projectRepository.create({
            projectName: dto.projectName,
            fileIds: dto.fileIds as types.file.FileId[],
        });
        return this.projectRepository.getPopulated(newProject._id);
    }

    async getProjectById(projectId: types.project.ProjectId): Promise<any | null> {
        return await this.projectRepository.getPopulated(projectId);
    }

    async listProjects(
        pagination: { page: number; limit: number },
    ): Promise<z.infer<typeof PaginatedProjectsResponseSchema>> {
        const { projects, total } = await this.projectRepository.listPopulated(pagination);

        const totalPages = Math.ceil(total / pagination.limit);

        return {
            projects: projects,
            meta: {
                totalItems: total,
                totalPages: totalPages,
                currentPage: pagination.page,
                itemsPerPage: pagination.limit,
            },
        };
    }

    async updateProject(
        projectId: types.project.ProjectId,
        dto: UpdateProjectDto,
    ): Promise<any | null> {
        if (dto.fileIds) {
            await this.validateFileIds(dto.fileIds as types.file.FileId[]);
        }

        await this.projectRepository.update(projectId, dto as any);

        return this.projectRepository.getPopulated(projectId);
    }

    async deleteProject(projectId: types.project.ProjectId): Promise<boolean> {
        return await this.projectRepository.delete(projectId);
    }

    async addFilesToProject(
        projectId: types.project.ProjectId,
        fileIds: types.file.FileId[],
    ): Promise<any | null> {
        const project = await this.projectRepository.get(projectId);
        if (!project) {
            return null;
        }

        await this.validateFileIds(fileIds);

        await this.projectRepository.addFiles(projectId, fileIds);

        return this.projectRepository.getPopulated(projectId);
    }

    async removeFilesFromProject(
        projectId: types.project.ProjectId,
        fileIds: types.file.FileId[],
    ): Promise<any | null> {
        const project = await this.projectRepository.get(projectId);
        if (!project) {
            return null;
        }

        await this.projectRepository.removeFiles(projectId, fileIds);

        return this.projectRepository.getPopulated(projectId);
    }
}
