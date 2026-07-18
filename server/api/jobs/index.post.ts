import type {H3Event} from "h3";
import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";
import formidable from "formidable";
import {z} from "zod";
import {uploadMetadataSchema} from "../../../shared/utils/schemas";
import {createBackendContext} from "../../utils/backend/context";
import {PublicJobError} from "../../utils/backend/errors";
import {
    createBrowserJobAccessToken,
    createInternalId,
    createPublicId,
    hashBrowserJobAccessToken
} from "../../utils/backend/ids";
import {ensurePathInside} from "../../utils/backend/paths";
import {
    checkJobCreationLimit,
    checkUploadRateLimit,
    getClientIp,
    releaseUploadSlot,
    tryAcquireUploadSlot
} from "../../utils/backend/rate-limits";
import {
    calculateStorageReservationBytes,
    cleanupJobFiles,
    createJobStorage,
    detectUploadExtension,
    getAvailableStorageBytes
} from "../../utils/backend/storage";

const fieldsSchema = z.object({
    email: z.string().email().max(320)
});
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

const collectUploadedFilePaths = (files: formidable.Files): string[] =>
    Object.values(files)
        .flat()
        .filter((file): file is formidable.File => Boolean(file?.filepath))
        .map((file) => file.filepath);

const parseMultipartUpload = async (
    event: H3Event,
    storageRoot: string,
    maxUploadBytes: number,
    uploadIdleTimeoutMs: number,
    onFileBegin: (path: string) => void
) => {
    const uploadDirectory = ensurePathInside(storageRoot, join(storageRoot, "uploads"));
    await mkdir(uploadDirectory, {recursive: true, mode: 0o700});

    const form = formidable({
        uploadDir: uploadDirectory,
        maxFields: 1,
        maxFieldsSize: 512,
        maxFiles: 1,
        maxFileSize: maxUploadBytes,
        multiples: false,
        allowEmptyFiles: false,
        filter(part) {
            if (part.name !== "file") {
                return false;
            }

            return Boolean(part.originalFilename && detectUploadExtension(part.originalFilename));
        },
        filename() {
            return `${crypto.randomUUID()}.upload`;
        }
    });

    const request = event.node.req;

    return await new Promise<{
        fields: formidable.Fields;
        files: formidable.Files;
    }>((resolve, reject) => {
        let settled = false;

        function onClose() {
            // Release the slot immediately if the client disconnects before the body finishes,
            // rather than waiting for a server-level request timeout.
            if (!request.complete) {
                finish(new Error("Upload connection closed before completion"));
            }
        }

        function finish(
            error: unknown,
            result?: {fields: formidable.Fields; files: formidable.Files}
        ) {
            if (settled) {
                return;
            }

            settled = true;
            request.setTimeout(0);
            request.off("close", onClose);

            if (error || !result) {
                reject(error instanceof Error ? error : new Error(String(error)));
                return;
            }

            resolve(result);
        }

        // Abort a stalled upload so a slow client cannot hold a scarce concurrent-upload slot. The
        // socket timeout resets on every received chunk, so it only fires on genuine inactivity and
        // never penalizes a large but steadily-transferring upload.
        if (uploadIdleTimeoutMs > 0) {
            request.setTimeout(uploadIdleTimeoutMs, () => {
                request.destroy(new Error("Upload idle timeout exceeded"));
            });
        }

        request.on("close", onClose);

        form.on("fileBegin", (_name, file) => {
            if (file.filepath) {
                onFileBegin(file.filepath);
            }
        });

        form.parse(request, (error, fields, files) => {
            if (error) {
                finish(error);
                return;
            }

            finish(null, {fields, files});
        });
    });
};

const estimateUploadReservationBytes = (event: H3Event, maxUploadBytes: number): number => {
    const contentLengthHeader = getHeader(event, "content-length");
    const contentLength =
        typeof contentLengthHeader === "string" ? Number(contentLengthHeader) : Number.NaN;

    if (Number.isFinite(contentLength) && contentLength > 0) {
        return Math.min(contentLength, maxUploadBytes + MULTIPART_OVERHEAD_BYTES);
    }

    return maxUploadBytes + MULTIPART_OVERHEAD_BYTES;
};

/**
 * POST /api/jobs creates an asynchronous audiobook-processing job.
 *
 * The request must contain exactly one `file` upload and one `email` field. Multipart bytes are
 * streamed to a temporary upload path, moved into private job storage, and queued in SQLite; FFmpeg
 * work is performed later by the worker. The response returns the public job ID and the one-time
 * browser job-access token, while only the token hash is stored.
 */
export default defineEventHandler(async (event) => {
    const {config, jobs} = await createBackendContext();
    const clientIp = getClientIp(event, config.trustProxy);

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

    if (!tryAcquireUploadSlot(config.maxConcurrentUploads)) {
        throw createError({
            statusCode: 429,
            statusMessage: "Too many active uploads",
            data: {
                error: {
                    code: "UPLOAD_LIMIT_EXCEEDED",
                    message: "Too many uploads are active. Please try again shortly."
                }
            }
        });
    }

    const contentLength = Number(getHeader(event, "content-length") || 0);
    if (contentLength > config.maxUploadBytes + MULTIPART_OVERHEAD_BYTES) {
        releaseUploadSlot();
        throw createError({
            statusCode: 413,
            statusMessage: "File too large",
            data: {error: {code: "FILE_TOO_LARGE", message: "The uploaded file is too large."}}
        });
    }

    let tempPaths: string[] = [];
    let tempPath: string | null = null;
    const internalId = createInternalId();
    let reservationOwnerId: string | null = internalId;
    let storedInternalId: string | null = null;

    try {
        if (!checkUploadRateLimit(clientIp, config.perIpUploadLimit, 60 * 60 * 1000)) {
            throw createError({
                statusCode: 429,
                statusMessage: "Upload rate limit exceeded",
                data: {
                    error: {
                        code: "UPLOAD_RATE_LIMIT_EXCEEDED",
                        message: "Too many uploads were started from this network."
                    }
                }
            });
        }

        const availableBytes = await getAvailableStorageBytes(config.storageRoot);
        if (availableBytes === null && process.env.NODE_ENV === "production") {
            throw new PublicJobError("STORAGE_CAPACITY_EXCEEDED");
        }

        if (availableBytes !== null) {
            const now = new Date();
            const estimatedUploadBytes = estimateUploadReservationBytes(
                event,
                config.maxUploadBytes
            );
            const reservedBytes = calculateStorageReservationBytes(
                estimatedUploadBytes,
                config.storageReservationMultiplier,
                config.storageReservationSafetyBytes
            );
            const reserved = jobs.createStorageReservationIfCapacity(
                {
                    ownerId: internalId,
                    reservedBytes,
                    createdAt: now.toISOString(),
                    expiresAt: new Date(
                        now.getTime() + config.storageReservationTtlMinutes * 60 * 1000
                    ).toISOString()
                },
                availableBytes
            );

            if (!reserved) {
                throw new PublicJobError("STORAGE_CAPACITY_EXCEEDED");
            }
        } else {
            reservationOwnerId = null;
        }

        const parsed = await parseMultipartUpload(
            event,
            config.storageRoot,
            config.maxUploadBytes,
            config.uploadIdleTimeoutSeconds * 1000,
            (path) => {
                tempPaths.push(path);
            }
        );
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

        if (!tempPath) {
            throw new PublicJobError("UNSUPPORTED_FILE_TYPE", "Upload temp file was not available");
        }

        const storedUpload = await createJobStorage(
            config.storageRoot,
            tempPath,
            originalFilename,
            internalId
        );
        storedInternalId = storedUpload.internalId;

        tempPath = null;
        tempPaths = [];
        if (!checkJobCreationLimit(clientIp, config.perIpJobLimit, 60 * 60 * 1000)) {
            await cleanupJobFiles(config.storageRoot, storedUpload.internalId);
            if (reservationOwnerId) {
                jobs.releaseStorageReservation(reservationOwnerId, new Date().toISOString());
            }
            throw createError({
                statusCode: 429,
                statusMessage: "Job rate limit exceeded",
                data: {
                    error: {
                        code: "JOB_RATE_LIMIT_EXCEEDED",
                        message: "Too many jobs were created from this network."
                    }
                }
            });
        }

        const publicJobId = createPublicId();
        const jobAccessToken = createBrowserJobAccessToken();
        const createdAt = new Date().toISOString();
        const created = jobs.createJobIfCapacity(
            {
                publicJobId,
                internalId: storedUpload.internalId,
                displayFilename: storedUpload.displayFilename,
                sourceFormat: storedUpload.sourceFormat,
                fileSize: storedUpload.fileSize,
                email,
                sourcePath: storedUpload.sourcePath,
                createdAt,
                browserJobAccessTokenHash: hashBrowserJobAccessToken(jobAccessToken)
            },
            config.maxQueuedJobs
        );
        if (!created) {
            await cleanupJobFiles(config.storageRoot, storedUpload.internalId);
            if (reservationOwnerId) {
                jobs.releaseStorageReservation(reservationOwnerId, new Date().toISOString());
            }
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
        setResponseStatus(event, 202);

        return {
            jobId: publicJobId,
            status: "queued",
            createdAt,
            jobAccessToken
        };
    } catch (error) {
        for (const path of tempPath ? [...tempPaths, tempPath] : tempPaths) {
            await rm(path, {force: true});
        }
        if (storedInternalId) {
            await cleanupJobFiles(config.storageRoot, storedInternalId);
        }
        if (reservationOwnerId) {
            jobs.releaseStorageReservation(reservationOwnerId, new Date().toISOString());
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
    } finally {
        releaseUploadSlot();
    }
});
