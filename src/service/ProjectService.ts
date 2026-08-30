import { Injectable } from "../ioc/decorator.ts";
import { ProjectSchema } from "../api/project/ProjectSchema.ts";
import * as types from "../types/index.ts";
import { FileRepository } from "../db/mongo/FileRepository.ts";
import { ProjectRepository } from "../db/mongo/ProjectRepository.ts";
import { FileProcessorService } from "./FileProcessorService.ts";
import { FileHelpers } from "./FileHelpers.ts";
import { DocCrawler } from "./DocCrawler.ts";
import * as db from "../db/mongo/Model.ts";
import { Buffer } from "node:buffer";
import { VectorCollectionFactory } from "../db/vectordb/VectorCollectionFactory.ts";

@Injectable()
export class ProjectService {
    constructor(
        private projectRepository: ProjectRepository,
        private fileRepository: FileRepository,
        private fileProcessorService: FileProcessorService,
        private fileHelpers: FileHelpers,
        private docCrawler: DocCrawler,
        private vectorCollectionFactory: VectorCollectionFactory,
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
            await this.addFilesToProjectNoCheck(newProject._id, fileIds);
        }
        const populated = await this.projectRepository.getPopulated(newProject._id);
        return populated ? this.mapDbToApi(populated) : null;
    }

    async createProjectFromUrl(
        projectName: string,
        url: string,
        maxPages: number = 50,
        onProgress?: (msg: string) => void,
        signal?: AbortSignal,
    ) {
        onProgress?.(`Starting documentation crawl for: ${url}`);

        const crawledPages = await this.docCrawler.crawl(url, onProgress, { maxPages }, signal);

        if (crawledPages.length === 0) {
            throw new Error(
                `No pages could be crawled from ${url}. The page may be empty, return ` +
                    `non-HTML content, or be JavaScript-rendered. Try a server-rendered docs ` +
                    `URL, or for an API spec use the raw OpenAPI/Swagger JSON (swagger-json ingestion).`,
            );
        }

        const fileIds: types.file.FileId[] = [];

        for (const page of crawledPages) {
            const slug = page.url
                .replace(/^https?:\/\//, "")
                .replace(/[^a-zA-Z0-9._-]/g, "_")
                .substring(0, 100);
            const filename = `${slug}.md`;

            const textBuffer = Buffer.from(page.markdown, "utf-8");
            const sanitizedBuffer = Buffer.from(
                this.fileProcessorService.sanitizeWhiteCharsInText(textBuffer),
            );

            const newFile = await this.fileRepository.create({
                filename,
                mimetype: "text/markdown",
                size: sanitizedBuffer.length,
                data: sanitizedBuffer,
            });

            fileIds.push(newFile._id);
        }

        onProgress?.(`Stored ${fileIds.length} pages. Creating project and indexing...`);
        return this.createProject(projectName, fileIds);
    }

    async getProjectById(projectId: types.project.ProjectId) {
        const project = await this.projectRepository.getPopulated(projectId);
        return project ? this.mapDbToApi(project) : null;
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

            const current = await this.projectRepository.get(projectId);
            if (current) {
                const oldSet = new Set(current.files);
                const newSet = new Set(updateDto.fileIds);
                const removed = current.files.filter((id) => !newSet.has(id));
                const added = updateDto.fileIds.filter((id) => !oldSet.has(id));

                if (removed.length > 0) {
                    const col = await this.vectorCollectionFactory.createCollection(projectId);
                    for (const fileId of removed) {
                        await col.deleteByFileId(fileId).catch(() => {});
                    }
                }

                if (added.length > 0) {
                    const allChunks: types.file.FileShard[] = [];
                    for (const fileId of added) {
                        const file = await this.fileRepository.get(fileId);
                        if (file) allChunks.push(...this.fileHelpers.chunkDbFile(file));
                    }
                    if (allChunks.length > 0) {
                        await this.fileProcessorService.processAndStore(allChunks, projectId);
                    }
                }
            }
        }

        await this.projectRepository.update(projectId, updateDto);
        const populated = await this.projectRepository.getPopulated(projectId);
        return populated ? this.mapDbToApi(populated) : null;
    }

    async deleteProject(projectId: types.project.ProjectId): Promise<boolean> {
        await this.vectorCollectionFactory.dropCollection(projectId);
        return await this.projectRepository.delete(projectId);
    }

    async addFilesToProject(projectId: types.project.ProjectId, fileIds: types.file.FileId[]) {
        const project = await this.projectRepository.get(projectId);
        if (!project) {
            return null;
        }
        await this.validateFileIds(fileIds);

        const alreadyIndexed = new Set(project.files);
        const toIndex = fileIds.filter((id) => !alreadyIndexed.has(id));

        await this.projectRepository.addFiles(projectId, fileIds);

        const errors: string[] = [];
        for (const fileId of toIndex) {
            const file = await this.fileRepository.get(fileId);
            if (!file) continue;
            try {
                await this.fileProcessorService.processAndStore(
                    this.fileHelpers.chunkDbFile(file),
                    projectId,
                );
            } catch (error) {
                errors.push(`${fileId}: ${(error as Error).message}`);
            }
        }

        if (errors.length > 0) {
            throw new Error(`Indexing failed for ${errors.length} file(s):\n${errors.join("\n")}`);
        }

        const populated = await this.projectRepository.getPopulated(projectId);
        return populated ? this.mapDbToApi(populated) : null;
    }

    async removeFilesFromProject(projectId: types.project.ProjectId, fileIds: types.file.FileId[]) {
        const project = await this.projectRepository.get(projectId);
        if (!project) {
            return null;
        }

        const col = await this.vectorCollectionFactory.createCollection(projectId);
        for (const fileId of fileIds) {
            await col.deleteByFileId(fileId).catch(() => {});
        }

        await this.projectRepository.removeFiles(projectId, fileIds);
        const populated = await this.projectRepository.getPopulated(projectId);
        return populated ? this.mapDbToApi(populated) : null;
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

        const populated = await this.projectRepository.getPopulated(projectId);
        return populated ? this.mapDbToApi(populated) : null;
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
