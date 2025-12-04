import { FileRepository } from "./FileRepository.ts";
import { ProjectRepository } from "./ProjectRepository.ts";
import * as types from "../types/index.ts";
import * as db from "../db/mongo/Model.ts";
import { Buffer } from "node:buffer";
import { FileProcessorService } from "./FileProcessorService.ts";

export class FileService {
    constructor(
        private fileRepository: FileRepository,
        private projectRepository: ProjectRepository,
        private fileProcessorService: FileProcessorService,
    ) {}

    async uploadFile(file: File, fileBuffer: Buffer): Promise<Omit<db.File, "data">> {
        if (file.size > 10 * 1024 * 1024) {
            throw new Error("File exceeds 10MB limit");
        }
        console.log(this.fileProcessorService.sanitizeWhiteCharsInText(fileBuffer));
        const newFile = await this.fileRepository.create({
            filename: file.name,
            mimetype: file.type,
            size: file.size,
            data: Buffer.from(this.fileProcessorService.sanitizeWhiteCharsInText(fileBuffer)),
        });
        const { data: _data, ...metadata } = newFile;
        return metadata;
    }

    async getFileMetadata(fileId: types.file.FileId): Promise<Omit<db.File, "data"> | null> {
        const result = await this.fileRepository.getMetadataByIds([fileId]);
        return result.length > 0 ? result[0] : null;
    }

    async downloadFile(
        fileId: types.file.FileId,
    ) {
        const fileDoc = await this.fileRepository.get(fileId);
        if (!fileDoc) {
            return null;
        }
        const { data, ...metadata } = fileDoc;
        const buffer = data.buffer;
        return { metadata, buffer };
    }

    async deleteFile(fileId: types.file.FileId): Promise<boolean> {
        await this.projectRepository.removeFileFromAllProjects(fileId);
        return this.fileRepository.delete(fileId);
    }

    async listFiles(
        pagination: { page: number; limit: number },
    ): Promise<{ files: Omit<db.File, "data">[]; meta: any }> {
        const { files, total } = await this.fileRepository.listPaginated(pagination);

        const totalPages = Math.ceil(total / pagination.limit);

        return {
            files: files,
            meta: {
                totalItems: total,
                totalPages: totalPages,
                currentPage: pagination.page,
                itemsPerPage: pagination.limit,
            },
        };
    }
}
