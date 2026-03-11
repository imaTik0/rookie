import { ProjectSchema } from "../api/project/ProjectSchema.ts";
import * as types from "../types/index.ts";
import { FileRepository } from "./FileRepository.ts";
import { ProjectRepository } from "./ProjectRepository.ts";
import { FileProcessorService } from "./FileProcessorService.ts";
import { FileHelpers } from "./FileHelpers.ts";
import * as db from "../db/mongo/Model.ts";

export class ProjectService {
    constructor(
        private projectRepository: ProjectRepository,
        private fileRepository: FileRepository,
        private fileProcessorService: FileProcessorService,
        private fileHelpers: FileHelpers,
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

    async createProject(projectName: string, fileIds?: types.file.FileId[]) {
        if (fileIds) {
            await this.validateFileIds(fileIds as types.file.FileId[]);
        }
        const newProject = await this.projectRepository.create({
            projectName: projectName,
            fileIds: fileIds as types.file.FileId[],
        });
        if (fileIds) {
            this.addFilesToProjectNoCheck(newProject._id, fileIds);
        }
        return this.projectRepository.getPopulated(newProject._id);
    }

    async getProjectById(projectId: types.project.ProjectId) {
        return await this.projectRepository.getPopulated(projectId);
    }

    async listProjects(
        pagination: { page: number; limit: number },
    ) {
        const { projects, total } = await this.projectRepository.listPopulated(pagination);
        const totalPages = Math.ceil(total / pagination.limit);
        return {
            projects: projects.map((project) => this.mapDbToApi(project)),
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
        updateDto: { projectName?: string; fileIds?: types.file.FileId[] },
    ) {
        if (updateDto.fileIds) {
            await this.validateFileIds(updateDto.fileIds as types.file.FileId[]);
        }
        await this.projectRepository.update(projectId, updateDto);
        return this.projectRepository.getPopulated(projectId);
    }

    async deleteProject(projectId: types.project.ProjectId): Promise<boolean> {
        return await this.projectRepository.delete(projectId);
    }

    async addFilesToProject(projectId: types.project.ProjectId, fileIds: types.file.FileId[]) {
        const project = await this.projectRepository.get(projectId);
        if (!project) {
            return null;
        }
        await this.validateFileIds(fileIds);
        await this.projectRepository.addFiles(projectId, fileIds);

        for (const fileId of fileIds) {
            try {
                const file = await this.fileRepository.get(fileId);
                if (!file) continue;
                await this.fileProcessorService.processAndStore(
                    this.fileHelpers.chunkDbFile(file),
                    projectId,
                );
            } catch (error) {
                console.error(`Failed to process file ${fileId} for project ${projectId}:`, error);
            }
        }

        return this.projectRepository.getPopulated(projectId);
    }

    async removeFilesFromProject(projectId: types.project.ProjectId, fileIds: types.file.FileId[]) {
        const project = await this.projectRepository.get(projectId);
        if (!project) {
            return null;
        }
        await this.projectRepository.removeFiles(projectId, fileIds);
        return this.projectRepository.getPopulated(projectId);
    }

    private async addFilesToProjectNoCheck(
        projectId: types.project.ProjectId,
        fileIds: types.file.FileId[],
    ) {
        await this.projectRepository.addFiles(projectId, fileIds);

        const allChunks: types.file.FileShard[] = [];
        for (const fileId of fileIds) {
            const file = await this.fileRepository.get(fileId);
            if (!file) continue;
            allChunks.push(...this.fileHelpers.chunkDbFile(file));
        }

        if (allChunks.length > 0) {
            await this.fileProcessorService.processAndStore(allChunks, projectId);
        }

        return this.projectRepository.getPopulated(projectId);
    }

    private mapDbToApi(model: db.PopulatedProject): ProjectSchema {
        return {
            id: model._id.toString(),
            projectName: model.projectName,
            createdAt: model.createdAt.toISOString(),
            updatedAt: model.updatedAt.toISOString(),
            files: model.files.map((file) => {
                return {
                    id: file._id.toString(),
                    filename: file.filename,
                    mimetype: file.mimetype,
                    size: file.size,
                    createdAt: file.createdAt.toISOString(),
                    updatedAt: file.updatedAt.toISOString(),
                };
            }),
        };
    }
}
