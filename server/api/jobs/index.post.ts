import type {H3Event} from "h3";
import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";
import formidable from "formidable";
import {z} from "zod";
import {uploadMetadataSchema} from "../../../shared/utils/schemas";
import {createBackendContext} from "../../utils/backend/context";
import {PublicJobError} from "../../utils/backend/errors";
import {createPublicId} from "../../utils/backend/ids";
import {ensurePathInside} from "../../utils/backend/paths";
import {
    createJobStorage,
    detectUploadExtension,
    ensureEnoughStorage
} from "../../utils/backend/storage";

const fieldsSchema = z.object({
    email: z.string().email().max(320)
});

const collectUploadedFilePaths = (files: formidable.Files): string[] =>
    Object.values(files)
        .flat()
        .filter((file): file is formidable.File => Boolean(file?.filepath))
        .map((file) => file.filepath);

const parseMultipartUpload = async (
    event: H3Event,
    storageRoot: string,
    maxUploadBytes: number
) => {
    const uploadDirectory = ensurePathInside(storageRoot, join(storageRoot, "uploads"));
    await mkdir(uploadDirectory, {recursive: true, mode: 0o700});

    const form = formidable({
        uploadDir: uploadDirectory,
        maxFiles: 1,
        maxFileSize: maxUploadBytes,
        multiples: false,
        allowEmptyFiles: false,
        filter(part) {
            if (part.name !== "file") {
                return true;
            }

            return Boolean(part.originalFilename && detectUploadExtension(part.originalFilename));
        },
        filename() {
            return `${crypto.randomUUID()}.upload`;
        }
    });

    return await new Promise<{
        fields: formidable.Fields;
        files: formidable.Files;
    }>((resolve, reject) => {
        form.parse(event.node.req, (error, fields, files) => {
            if (error) {
                reject(error);
                return;
            }

            resolve({fields, files});
        });
    });
};

export default defineEventHandler(async (event) => {
    const {config, jobs} = await createBackendContext();

    if (jobs.countQueuedJobs() >= config.maxQueuedJobs) {
        throw createError({
            statusCode: 503,
            statusMessage: "Queue capacity exceeded",
            data: {
                error: {
                    code: "QUEUE_CAPACITY_EXCEEDED",
                    message: "The processing queue is full. Please try again later."
                }
            }
        });
    }

    const contentLength = Number(getHeader(event, "content-length") || 0);
    if (contentLength > config.maxUploadBytes) {
        throw createError({
            statusCode: 413,
            statusMessage: "File too large",
            data: {error: {code: "FILE_TOO_LARGE", message: "The uploaded file is too large."}}
        });
    }

    let tempPaths: string[] = [];
    let tempPath: string | null = null;

    try {
        const parsed = await parseMultipartUpload(event, config.storageRoot, config.maxUploadBytes);
        tempPaths = collectUploadedFilePaths(parsed.files);
        const emailValues = Array.isArray(parsed.fields.email)
            ? parsed.fields.email
            : [parsed.fields.email];
        const emailValue = emailValues[0];
        const {email} = fieldsSchema.parse({email: emailValue});
        const fileValues = parsed.files.file;
        const files = Array.isArray(fileValues) ? fileValues : [fileValues];
        const file = files[0];

        if (
            !file ||
            files.length !== 1 ||
            emailValues.length !== 1 ||
            Object.keys(parsed.files).length !== 1 ||
            Object.keys(parsed.fields).length !== 1
        ) {
            throw new PublicJobError(
                "UNSUPPORTED_FILE_TYPE",
                "Expected exactly one file and email field"
            );
        }

        tempPath = file.filepath;
        const originalFilename = file.originalFilename || "audiobook";
        const extension = detectUploadExtension(originalFilename);
        if (!extension) {
            throw new PublicJobError("UNSUPPORTED_FILE_TYPE");
        }

        const fileSize = file.size;
        uploadMetadataSchema.parse({
            email,
            fileName: originalFilename,
            fileSize,
            extension
        });

        if (!(await ensureEnoughStorage(config.storageRoot, fileSize))) {
            throw new PublicJobError("STORAGE_CAPACITY_EXCEEDED");
        }

        if (!tempPath) {
            throw new PublicJobError("UNSUPPORTED_FILE_TYPE", "Upload temp file was not available");
        }

        const storedUpload = await createJobStorage(config.storageRoot, tempPath, originalFilename);
        tempPath = null;
        tempPaths = [];
        const publicJobId = createPublicId();
        const createdAt = new Date().toISOString();
        jobs.createJob({
            publicJobId,
            internalId: storedUpload.internalId,
            displayFilename: storedUpload.displayFilename,
            sourceFormat: storedUpload.sourceFormat,
            fileSize: storedUpload.fileSize,
            email,
            sourcePath: storedUpload.sourcePath,
            createdAt
        });
        setResponseStatus(event, 202);

        return {
            jobId: publicJobId,
            status: "queued",
            createdAt
        };
    } catch (error) {
        for (const path of tempPath ? [...tempPaths, tempPath] : tempPaths) {
            await rm(path, {force: true});
        }

        if (error instanceof PublicJobError) {
            const statusCode =
                error.code === "FILE_TOO_LARGE"
                    ? 413
                    : error.code === "STORAGE_CAPACITY_EXCEEDED"
                      ? 503
                      : 415;

            throw createError({
                statusCode,
                statusMessage: error.code,
                data: {error: {code: error.code, message: error.publicMessage}}
            });
        }

        if (error instanceof z.ZodError) {
            throw createError({
                statusCode: 400,
                statusMessage: "Invalid upload",
                data: {error: {code: "INVALID_UPLOAD", message: "The upload fields are invalid."}}
            });
        }

        if (
            typeof error === "object" &&
            error !== null &&
            ("httpCode" in error || "message" in error)
        ) {
            const httpCode = "httpCode" in error ? Number(error.httpCode) : 0;
            const message = "message" in error ? String(error.message) : "";

            if (httpCode === 413 || message.toLowerCase().includes("maxfilesize")) {
                throw createError({
                    statusCode: 413,
                    statusMessage: "File too large",
                    data: {
                        error: {
                            code: "FILE_TOO_LARGE",
                            message: "The uploaded audiobook is larger than the configured limit."
                        }
                    }
                });
            }
        }

        throw error;
    }
});
