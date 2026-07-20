import {rm} from "node:fs/promises";
import {z} from "zod";
import {outputFormatSchema, uploadMetadataSchema} from "../../shared/utils/schemas";
import {createBackendContext} from "../utils/backend/context";
import {PublicJobError} from "../utils/backend/errors";
import {
    createBrowserJobAccessToken,
    createInternalId,
    createPublicId,
    hashBrowserJobAccessToken
} from "../utils/backend/ids";
import {
    checkJobCreationLimit,
    checkUploadRateLimit,
    getClientIp,
    releaseUploadSlot,
    tryAcquireUploadSlot
} from "../utils/backend/rate-limits";
import {
    calculateStorageReservationBytes,
    cleanupJobFiles,
    createJobStorage,
    detectUploadExtension,
    getAvailableStorageBytes
} from "../utils/backend/storage";
import {
    collectUploadedFilePaths,
    estimateUploadReservationBytes,
    MULTIPART_OVERHEAD_BYTES,
    parseConvertFields,
    parseMultipartUpload
} from "../utils/backend/upload-request";

/**
 * POST /api/convert creates an asynchronous format-conversion job (mp3 <-> m4b).
 *
 * It mirrors POST /api/jobs (same slot/capacity/reservation/storage machinery and shared queue), but
 * queues a `kind: "convert"` job: the worker transcodes the whole file to the requested target
 * format, preserving metadata/cover/chapters, and produces a single downloadable file rather than a
 * ZIP of chapters. There is no chapter requirement, so any valid mp3/m4b is accepted. The target
 * `outputFormat` is mandatory and must differ from the source format.
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
        const {
            file,
            originalFilename,
            email,
            outputFormat: rawOutputFormat
        } = parseConvertFields(parsed);

        tempPath = file.filepath;
        const extension = detectUploadExtension(originalFilename);
        if (!extension) {
            throw new PublicJobError("UNSUPPORTED_FILE_TYPE");
        }

        const outputFormat = outputFormatSchema.parse(rawOutputFormat);
        // Converting to the same format would be a pointless lossy re-encode; the client's target
        // selector excludes it, and this guards the API directly.
        if (outputFormat === extension) {
            throw new PublicJobError(
                "UNSUPPORTED_FILE_TYPE",
                "Choose a different target format than the source"
            );
        }

        const fileSize = file.size;
        uploadMetadataSchema.parse({
            email,
            fileName: originalFilename,
            fileSize,
            extension,
            outputFormat,
            splitWithoutChapters: false
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
                kind: "convert",
                displayFilename: storedUpload.displayFilename,
                sourceFormat: storedUpload.sourceFormat,
                outputFormat,
                fileSize: storedUpload.fileSize,
                email,
                sourcePath: storedUpload.sourcePath,
                createdAt,
                browserJobAccessTokenHash: hashBrowserJobAccessToken(jobAccessToken),
                splitWithoutChapters: false
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
