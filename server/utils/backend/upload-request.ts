import type {H3Event} from "h3";
import type {BackendConfig} from "./config";
import {mkdir} from "node:fs/promises";
import {join} from "node:path";
import formidable from "formidable";
import {z} from "zod";
import {PublicJobError} from "./errors";
import {ensurePathInside} from "./paths";
import {detectUploadExtension} from "./storage";

/**
 * Slack added to the configured max upload size when bounding the multipart body, so multipart
 * framing overhead does not cause a legitimately-sized file to trip the size guard.
 */
export const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

/**
 * The non-file multipart fields the client is allowed to send. The parser's `maxFields` budget and
 * the allow-list in `parseUploadFields` are both derived from this list, so adding a client field
 * can never silently exceed the field budget again (which formidable reports as a 413).
 */
export const UPLOAD_FIELD_NAMES = ["email", "outputFormat", "splitWithoutChapters"] as const;

const fieldsSchema = z.object({
    email: z.string().email().max(320)
});

export interface ParsedUpload {
    fields: formidable.Fields;
    files: formidable.Files;
}

/**
 * Bounds on a single multipart upload request.
 *
 * The idle timeout only catches a client that stops sending altogether: it resets on every received
 * chunk, so a client that trickles a byte every few seconds keeps it alive indefinitely and holds
 * one of the very few concurrent-upload slots hostage. `maxDurationMs` and `minBytesPerSecond`
 * bound the request as a whole and close that gap. Any of the three set to `0` disables just that
 * bound.
 */
export interface UploadLimits {
    maxUploadBytes: number;
    idleTimeoutMs: number;
    maxDurationMs: number;
    minBytesPerSecond: number;
}

/**
 * Grace period before the sustained-rate floor starts being enforced, so TLS setup, request
 * queueing, and TCP slow start cannot fail an upload that is merely getting going. The hard
 * lifetime ceiling applies from the first byte and is unaffected by this.
 */
export const UPLOAD_RATE_GRACE_MS = 15_000;

/** How often the total-duration and sustained-rate bounds are re-evaluated. */
const UPLOAD_WATCHDOG_INTERVAL_MS = 1_000;

export const uploadLimitsFromConfig = (config: BackendConfig): UploadLimits => ({
    maxUploadBytes: config.maxUploadBytes,
    idleTimeoutMs: config.uploadIdleTimeoutSeconds * 1000,
    maxDurationMs: config.uploadMaxSeconds * 1000,
    minBytesPerSecond: config.uploadMinBytesPerSecond
});

export interface UploadFields {
    file: formidable.File;
    originalFilename: string;
    email: string;
    outputFormatValues: string[];
    splitWithoutChapters: boolean;
}

export interface ConvertFields {
    file: formidable.File;
    originalFilename: string;
    email: string;
    outputFormat: string;
}

export const collectUploadedFilePaths = (files: formidable.Files): string[] =>
    Object.values(files)
        .flat()
        .filter((file): file is formidable.File => Boolean(file?.filepath))
        .map((file) => file.filepath);

/**
 * Streams one multipart upload to a temporary file inside the storage root.
 *
 * `onFileBegin` reports each temp path as soon as formidable opens it so the caller can clean up
 * even if the request aborts mid-stream. Three independent bounds (see `UploadLimits`) abort a
 * client that cannot be allowed to keep its upload slot: an inactivity timeout, a hard total
 * lifetime, and a sustained-throughput floor. Every abort path destroys the request, which rejects
 * this promise so the caller deletes the partial file and releases the slot.
 */
export const parseMultipartUpload = async (
    event: H3Event,
    storageRoot: string,
    limits: UploadLimits,
    onFileBegin: (path: string) => void
): Promise<ParsedUpload> => {
    const {maxUploadBytes, idleTimeoutMs, maxDurationMs, minBytesPerSecond} = limits;
    const uploadDirectory = ensurePathInside(storageRoot, join(storageRoot, "uploads"));
    await mkdir(uploadDirectory, {recursive: true, mode: 0o700});

    const form = formidable({
        uploadDir: uploadDirectory,
        // Budget exactly the non-file fields the client sends (see UPLOAD_FIELD_NAMES).
        maxFields: UPLOAD_FIELD_NAMES.length,
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

    return await new Promise<ParsedUpload>((resolve, reject) => {
        let settled = false;
        let watchdog: NodeJS.Timeout | null = null;
        let receivedBytes = 0;
        const startedAtMs = Date.now();

        function onClose() {
            // Release the slot immediately if the client disconnects before the body finishes,
            // rather than waiting for a server-level request timeout.
            if (!request.complete) {
                finish(new Error("Upload connection closed before completion"));
            }
        }

        function finish(error: unknown, result?: ParsedUpload) {
            if (settled) {
                return;
            }

            settled = true;
            request.setTimeout(0);
            request.off("close", onClose);

            if (watchdog) {
                clearInterval(watchdog);
                watchdog = null;
            }

            if (error || !result) {
                reject(error instanceof Error ? error : new Error(String(error)));
                return;
            }

            resolve(result);
        }

        // Abort a stalled upload so a slow client cannot hold a scarce concurrent-upload slot. The
        // socket timeout resets on every received chunk, so it only fires on genuine inactivity and
        // never penalizes a large but steadily-transferring upload.
        if (idleTimeoutMs > 0) {
            request.setTimeout(idleTimeoutMs, () => {
                request.destroy(new Error("Upload idle timeout exceeded"));
            });
        }

        // Because the idle timer above is reset by any traffic at all, bound the request as a whole
        // too, or a deliberate byte-per-interval drip would occupy an upload slot forever. Progress
        // is read from formidable rather than a second `data` listener on the request, which would
        // resume the stream before formidable subscribes and lose the first chunks.
        if (maxDurationMs > 0 || minBytesPerSecond > 0) {
            form.on("progress", (bytesReceived) => {
                receivedBytes = bytesReceived;
            });

            watchdog = setInterval(() => {
                const elapsedMs = Date.now() - startedAtMs;

                if (maxDurationMs > 0 && elapsedMs >= maxDurationMs) {
                    request.destroy(new Error("Upload total time limit exceeded"));

                    return;
                }

                // Compared as a product so the floor holds from the first evaluation without
                // dividing by a possibly-zero elapsed time.
                if (
                    minBytesPerSecond > 0 &&
                    elapsedMs >= UPLOAD_RATE_GRACE_MS &&
                    receivedBytes * 1000 < minBytesPerSecond * elapsedMs
                ) {
                    request.destroy(new Error("Upload transfer rate below the minimum"));
                }
            }, UPLOAD_WATCHDOG_INTERVAL_MS);
            watchdog.unref();
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

export const estimateUploadReservationBytes = (event: H3Event, maxUploadBytes: number): number => {
    const contentLengthHeader = getHeader(event, "content-length");
    const contentLength =
        typeof contentLengthHeader === "string" ? Number(contentLengthHeader) : Number.NaN;

    if (Number.isFinite(contentLength) && contentLength > 0) {
        return Math.min(contentLength, maxUploadBytes + MULTIPART_OVERHEAD_BYTES);
    }

    return maxUploadBytes + MULTIPART_OVERHEAD_BYTES;
};

const singleValues = (raw: string | string[] | undefined): string[] =>
    Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];

/**
 * Validates that the multipart payload is exactly one audiobook file, one email, and at most one
 * each of the optional `outputFormat`/`splitWithoutChapters` fields — rejecting duplicate fields,
 * extra fields, or extra files. Returns the singleton values; the caller resolves the output
 * format (which defaults to the detected extension) and validates the file itself.
 */
export const parseUploadFields = (parsed: ParsedUpload): UploadFields => {
    const emailValues = singleValues(parsed.fields.email);
    const {email} = fieldsSchema.parse({email: emailValues[0]});
    const outputFormatValues = singleValues(parsed.fields.outputFormat);
    const splitWithoutChaptersValues = singleValues(parsed.fields.splitWithoutChapters);
    const allowedFieldNames = new Set<string>(UPLOAD_FIELD_NAMES);
    const fileValues = parsed.files.file;
    const files = Array.isArray(fileValues) ? fileValues : [fileValues];
    const file = files[0];

    if (
        !file ||
        files.length !== 1 ||
        emailValues.length !== 1 ||
        outputFormatValues.length > 1 ||
        splitWithoutChaptersValues.length > 1 ||
        Object.keys(parsed.files).length !== 1 ||
        Object.keys(parsed.fields).some((name) => !allowedFieldNames.has(name))
    ) {
        throw new PublicJobError(
            "UNSUPPORTED_FILE_TYPE",
            "Expected one file, an email, and an optional output format"
        );
    }

    return {
        file,
        originalFilename: file.originalFilename || "audiobook",
        email,
        outputFormatValues,
        // Multipart fields arrive as strings; treat only the explicit "true" as opt-in.
        splitWithoutChapters: splitWithoutChaptersValues[0] === "true"
    };
};

/**
 * Field validation for the standalone converter: exactly one audiobook file, one email, and one
 * required target `outputFormat`. Unlike `parseUploadFields`, there is no `splitWithoutChapters`
 * field, and the output format is mandatory (the converter always targets a specific format).
 */
export const parseConvertFields = (parsed: ParsedUpload): ConvertFields => {
    const emailValues = singleValues(parsed.fields.email);
    const {email} = fieldsSchema.parse({email: emailValues[0]});
    const outputFormatValues = singleValues(parsed.fields.outputFormat);
    const allowedFieldNames = new Set<string>(["email", "outputFormat"]);
    const fileValues = parsed.files.file;
    const files = Array.isArray(fileValues) ? fileValues : [fileValues];
    const file = files[0];
    const outputFormat = outputFormatValues[0];

    if (
        !file ||
        files.length !== 1 ||
        emailValues.length !== 1 ||
        outputFormatValues.length !== 1 ||
        !outputFormat ||
        Object.keys(parsed.files).length !== 1 ||
        Object.keys(parsed.fields).some((name) => !allowedFieldNames.has(name))
    ) {
        throw new PublicJobError(
            "UNSUPPORTED_FILE_TYPE",
            "Expected one file, an email, and a target format"
        );
    }

    return {
        file,
        originalFilename: file.originalFilename || "audiobook",
        email,
        outputFormat
    };
};
