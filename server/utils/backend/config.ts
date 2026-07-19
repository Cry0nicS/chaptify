import {mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {z} from "zod";

export const DEFAULT_STORAGE_ROOT = resolve(process.cwd(), ".chaptify-storage");

const numericEnvSchema = (defaultValue: number, minimum: number) =>
    z
        .union([z.string(), z.number(), z.undefined(), z.null()])
        .transform((value) => {
            if (value === undefined || value === null || value === "") {
                return defaultValue;
            }

            return Number(value);
        })
        .pipe(z.number().int().min(minimum));

const runtimeConfigSchema = z.object({
    appBaseUrl: z.string().url().optional().or(z.literal("")),
    storageRoot: z.string().min(1),
    maxUploadBytes: numericEnvSchema(1_073_741_824, 1),
    maxQueuedJobs: numericEnvSchema(10, 1),
    maxConcurrentUploads: numericEnvSchema(2, 1),
    uploadIdleTimeoutSeconds: numericEnvSchema(30, 1),
    // Coerce because Nuxt parses runtimeConfig env overrides with destr, so `NUXT_TRUST_PROXY=false`
    // (or `true`/`1`) arrives as a boolean/number; the trust policy is interpreted as a string.
    trustProxy: z.coerce.string().optional().default(""),
    perIpUploadLimit: numericEnvSchema(5, 1),
    perIpJobLimit: numericEnvSchema(5, 1),
    downloadRateLimit: numericEnvSchema(30, 1),
    storageReservationMultiplier: numericEnvSchema(4, 1),
    storageReservationSafetyBytes: numericEnvSchema(268_435_456, 0),
    storageReservationTtlMinutes: numericEnvSchema(120, 1),
    orphanJobDirectoryMinAgeMinutes: numericEnvSchema(30, 1),
    cleanupIntervalSeconds: numericEnvSchema(300, 1),
    browserDownloadGrantLifetimeSeconds: numericEnvSchema(60, 1),
    browserDownloadGrantUsedGraceSeconds: numericEnvSchema(300, 1),
    workerConcurrency: numericEnvSchema(1, 1),
    jobRetentionHours: numericEnvSchema(12, 1),
    maxAudiobookDurationSeconds: numericEnvSchema(86_400, 1),
    maxChapters: numericEnvSchema(300, 1),
    jobProcessingTimeoutSeconds: numericEnvSchema(14_400, 1),
    ffprobeTimeoutSeconds: numericEnvSchema(30, 1),
    ffmpegChapterTimeoutSeconds: numericEnvSchema(1_200, 1),
    emailRetryAttempts: numericEnvSchema(3, 0),
    downloadSigningSecret: z.string().min(32).optional().or(z.literal("")),
    emailRetryBaseDelaySeconds: numericEnvSchema(60, 1),
    emailRetryMaxDelaySeconds: numericEnvSchema(3600, 1),
    mailgunBaseUrl: z.string().optional().default(""),
    mailgunDomain: z.string().optional().default(""),
    mailgunKey: z.string().optional().default(""),
    mailgunSender: z.string().email().optional().or(z.literal("")),
    mailgunRecipient: z.string().email().optional().or(z.literal("")),
    mailgunBcc: z.string().email().optional().or(z.literal("")),
    contactRecipient: z.string().email().optional().or(z.literal("")),
    contactRateLimit: numericEnvSchema(5, 1)
});

export type BackendConfig = z.infer<typeof runtimeConfigSchema>;

/**
 * Reads backend configuration for the standalone worker process.
 *
 * The worker does not run inside Nuxt's runtime config container, so it depends on environment
 * variables loaded by the startup wrapper before this function is called.
 */
export const getBackendConfigFromEnv = (): BackendConfig =>
    runtimeConfigSchema.parse({
        appBaseUrl:
            process.env.CHAPTIFY_APP_BASE_URL ||
            process.env.NUXT_APP_BASE_URL ||
            "http://localhost:3000",
        storageRoot: process.env.NUXT_STORAGE_ROOT || DEFAULT_STORAGE_ROOT,
        maxUploadBytes: process.env.NUXT_MAX_UPLOAD_BYTES,
        maxQueuedJobs: process.env.NUXT_MAX_QUEUED_JOBS,
        maxConcurrentUploads: process.env.NUXT_MAX_CONCURRENT_UPLOADS,
        uploadIdleTimeoutSeconds: process.env.NUXT_UPLOAD_IDLE_TIMEOUT_SECONDS,
        trustProxy: process.env.NUXT_TRUST_PROXY || "",
        perIpUploadLimit: process.env.NUXT_PER_IP_UPLOAD_LIMIT,
        perIpJobLimit: process.env.NUXT_PER_IP_JOB_LIMIT,
        downloadRateLimit: process.env.NUXT_DOWNLOAD_RATE_LIMIT,
        storageReservationMultiplier: process.env.NUXT_STORAGE_RESERVATION_MULTIPLIER,
        storageReservationSafetyBytes: process.env.NUXT_STORAGE_RESERVATION_SAFETY_BYTES,
        storageReservationTtlMinutes: process.env.NUXT_STORAGE_RESERVATION_TTL_MINUTES,
        orphanJobDirectoryMinAgeMinutes: process.env.NUXT_ORPHAN_JOB_DIRECTORY_MIN_AGE_MINUTES,
        cleanupIntervalSeconds: process.env.NUXT_CLEANUP_INTERVAL_SECONDS,
        browserDownloadGrantLifetimeSeconds:
            process.env.NUXT_BROWSER_DOWNLOAD_GRANT_LIFETIME_SECONDS,
        browserDownloadGrantUsedGraceSeconds:
            process.env.NUXT_BROWSER_DOWNLOAD_GRANT_USED_GRACE_SECONDS,
        workerConcurrency: process.env.NUXT_WORKER_CONCURRENCY,
        jobRetentionHours: process.env.NUXT_JOB_RETENTION_HOURS,
        maxAudiobookDurationSeconds: process.env.NUXT_MAX_AUDIOBOOK_DURATION_SECONDS,
        maxChapters: process.env.NUXT_MAX_CHAPTERS,
        jobProcessingTimeoutSeconds: process.env.NUXT_JOB_PROCESSING_TIMEOUT_SECONDS,
        ffprobeTimeoutSeconds: process.env.NUXT_FFPROBE_TIMEOUT_SECONDS,
        ffmpegChapterTimeoutSeconds: process.env.NUXT_FFMPEG_CHAPTER_TIMEOUT_SECONDS,
        emailRetryAttempts: process.env.NUXT_EMAIL_RETRY_ATTEMPTS,
        downloadSigningSecret: process.env.NUXT_DOWNLOAD_SIGNING_SECRET || "",
        emailRetryBaseDelaySeconds: process.env.NUXT_EMAIL_RETRY_BASE_DELAY_SECONDS,
        emailRetryMaxDelaySeconds: process.env.NUXT_EMAIL_RETRY_MAX_DELAY_SECONDS,
        mailgunBaseUrl: process.env.NUXT_MAILGUN_BASE_URL || "",
        mailgunDomain: process.env.NUXT_MAILGUN_DOMAIN || "",
        mailgunKey: process.env.NUXT_MAILGUN_KEY || "",
        mailgunSender: process.env.NUXT_MAILGUN_SENDER || "",
        mailgunRecipient: process.env.NUXT_MAILGUN_RECIPIENT || "",
        mailgunBcc: process.env.NUXT_MAILGUN_BCC || "",
        contactRecipient: process.env.NUXT_CONTACT_RECIPIENT || "",
        contactRateLimit: process.env.NUXT_CONTACT_RATE_LIMIT
    });

/**
 * Reads backend configuration inside Nitro while preserving worker-compatible fallbacks.
 *
 * Environment values can still override runtime config during Docker starts, and
 * `CHAPTIFY_APP_BASE_URL` avoids Nuxt treating `NUXT_APP_BASE_URL` as a route base path.
 */
/**
 * Returns the first source value that is actually set.
 *
 * Like `a || b || c` for the string inputs this config uses, but treats only `undefined`, `null`,
 * and `""` as unset — so a legitimate `0` from one source is not silently discarded in favour of a
 * later fallback.
 */
const pick = (...values: unknown[]): unknown =>
    values.find((value) => value !== undefined && value !== null && value !== "");

export const getBackendConfig = (): BackendConfig => {
    const runtimeConfig = typeof useRuntimeConfig === "function" ? useRuntimeConfig() : {};
    const values = runtimeConfig as Record<string, unknown>;

    return runtimeConfigSchema.parse({
        appBaseUrl: pick(
            process.env.CHAPTIFY_APP_BASE_URL,
            process.env.NUXT_APP_BASE_URL,
            values.appBaseUrl,
            "http://localhost:3000"
        ),
        storageRoot: pick(values.storageRoot, process.env.NUXT_STORAGE_ROOT, DEFAULT_STORAGE_ROOT),
        maxUploadBytes: pick(values.maxUploadBytes, process.env.NUXT_MAX_UPLOAD_BYTES),
        maxQueuedJobs: pick(values.maxQueuedJobs, process.env.NUXT_MAX_QUEUED_JOBS),
        maxConcurrentUploads: pick(
            values.maxConcurrentUploads,
            process.env.NUXT_MAX_CONCURRENT_UPLOADS
        ),
        uploadIdleTimeoutSeconds: pick(
            values.uploadIdleTimeoutSeconds,
            process.env.NUXT_UPLOAD_IDLE_TIMEOUT_SECONDS
        ),
        trustProxy: pick(values.trustProxy, process.env.NUXT_TRUST_PROXY, ""),
        perIpUploadLimit: pick(values.perIpUploadLimit, process.env.NUXT_PER_IP_UPLOAD_LIMIT),
        perIpJobLimit: pick(values.perIpJobLimit, process.env.NUXT_PER_IP_JOB_LIMIT),
        downloadRateLimit: pick(values.downloadRateLimit, process.env.NUXT_DOWNLOAD_RATE_LIMIT),
        storageReservationMultiplier: pick(
            values.storageReservationMultiplier,
            process.env.NUXT_STORAGE_RESERVATION_MULTIPLIER
        ),
        storageReservationSafetyBytes: pick(
            values.storageReservationSafetyBytes,
            process.env.NUXT_STORAGE_RESERVATION_SAFETY_BYTES
        ),
        storageReservationTtlMinutes: pick(
            values.storageReservationTtlMinutes,
            process.env.NUXT_STORAGE_RESERVATION_TTL_MINUTES
        ),
        orphanJobDirectoryMinAgeMinutes: pick(
            values.orphanJobDirectoryMinAgeMinutes,
            process.env.NUXT_ORPHAN_JOB_DIRECTORY_MIN_AGE_MINUTES
        ),
        cleanupIntervalSeconds: pick(
            values.cleanupIntervalSeconds,
            process.env.NUXT_CLEANUP_INTERVAL_SECONDS
        ),
        browserDownloadGrantLifetimeSeconds: pick(
            values.browserDownloadGrantLifetimeSeconds,
            process.env.NUXT_BROWSER_DOWNLOAD_GRANT_LIFETIME_SECONDS
        ),
        browserDownloadGrantUsedGraceSeconds: pick(
            values.browserDownloadGrantUsedGraceSeconds,
            process.env.NUXT_BROWSER_DOWNLOAD_GRANT_USED_GRACE_SECONDS
        ),
        workerConcurrency: pick(values.workerConcurrency, process.env.NUXT_WORKER_CONCURRENCY),
        jobRetentionHours: pick(values.jobRetentionHours, process.env.NUXT_JOB_RETENTION_HOURS),
        maxAudiobookDurationSeconds: pick(
            values.maxAudiobookDurationSeconds,
            process.env.NUXT_MAX_AUDIOBOOK_DURATION_SECONDS
        ),
        maxChapters: pick(values.maxChapters, process.env.NUXT_MAX_CHAPTERS),
        jobProcessingTimeoutSeconds: pick(
            values.jobProcessingTimeoutSeconds,
            process.env.NUXT_JOB_PROCESSING_TIMEOUT_SECONDS
        ),
        ffprobeTimeoutSeconds: pick(
            values.ffprobeTimeoutSeconds,
            process.env.NUXT_FFPROBE_TIMEOUT_SECONDS
        ),
        ffmpegChapterTimeoutSeconds: pick(
            values.ffmpegChapterTimeoutSeconds,
            process.env.NUXT_FFMPEG_CHAPTER_TIMEOUT_SECONDS
        ),
        emailRetryAttempts: pick(values.emailRetryAttempts, process.env.NUXT_EMAIL_RETRY_ATTEMPTS),
        downloadSigningSecret: pick(
            values.downloadSigningSecret,
            process.env.NUXT_DOWNLOAD_SIGNING_SECRET,
            ""
        ),
        emailRetryBaseDelaySeconds: pick(
            values.emailRetryBaseDelaySeconds,
            process.env.NUXT_EMAIL_RETRY_BASE_DELAY_SECONDS
        ),
        emailRetryMaxDelaySeconds: pick(
            values.emailRetryMaxDelaySeconds,
            process.env.NUXT_EMAIL_RETRY_MAX_DELAY_SECONDS
        ),
        mailgunBaseUrl: pick(values.mailgunBaseUrl, process.env.NUXT_MAILGUN_BASE_URL, ""),
        mailgunDomain: pick(values.mailgunDomain, process.env.NUXT_MAILGUN_DOMAIN, ""),
        mailgunKey: pick(values.mailgunKey, process.env.NUXT_MAILGUN_KEY, ""),
        mailgunSender: pick(values.mailgunSender, process.env.NUXT_MAILGUN_SENDER, ""),
        mailgunRecipient: pick(values.mailgunRecipient, process.env.NUXT_MAILGUN_RECIPIENT, ""),
        mailgunBcc: pick(values.mailgunBcc, process.env.NUXT_MAILGUN_BCC, ""),
        contactRecipient: pick(values.contactRecipient, process.env.NUXT_CONTACT_RECIPIENT, ""),
        contactRateLimit: pick(values.contactRateLimit, process.env.NUXT_CONTACT_RATE_LIMIT)
    });
};

export const normalizeBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/, "");

/**
 * Fails fast when a production process is missing configuration its core features require.
 *
 * Outside production this is a no-op so local development keeps working with lenient defaults. A
 * missing signing secret (needed to sign/verify download links) is always fatal. Mailgun config is
 * only required by processes that actually send email (the worker), so pass `requireMailgun` there.
 *
 * A localhost `appBaseUrl` is only a warning: emailed links would not work for external recipients
 * in a real deployment, but localhost is legitimate for local and containerized smoke testing.
 */
export const validateProductionConfig = (
    config: BackendConfig,
    options: {requireMailgun?: boolean} = {}
): void => {
    if (process.env.NODE_ENV !== "production") {
        return;
    }

    const problems: string[] = [];

    if (!config.downloadSigningSecret || config.downloadSigningSecret.length < 32) {
        problems.push("NUXT_DOWNLOAD_SIGNING_SECRET must be set to at least 32 characters");
    }

    if (options.requireMailgun) {
        if (!config.mailgunKey) {
            problems.push("NUXT_MAILGUN_KEY is required");
        }

        if (!config.mailgunDomain) {
            problems.push("NUXT_MAILGUN_DOMAIN is required");
        }

        if (!config.mailgunSender) {
            problems.push("NUXT_MAILGUN_SENDER is required");
        }

        if (!config.mailgunBaseUrl) {
            problems.push("NUXT_MAILGUN_BASE_URL is required");
        }
    }

    if (!config.appBaseUrl) {
        problems.push("NUXT_APP_BASE_URL must be set to the public application origin");
    } else if (/localhost|127\.0\.0\.1|::1/i.test(config.appBaseUrl)) {
        console.warn(
            "NUXT_APP_BASE_URL is a localhost origin; emailed download links will not work for external recipients"
        );
    }

    if (problems.length > 0) {
        throw new Error(`Invalid production configuration:\n - ${problems.join("\n - ")}`);
    }
};

/**
 * Creates the shared storage directories required by both API and worker processes.
 *
 * The storage root must be writable but is never served statically; public access always goes
 * through token-checked API routes.
 */
export const ensureStorageRoot = async (storageRoot: string) => {
    await mkdir(resolve(storageRoot, "database"), {recursive: true, mode: 0o700});
    await mkdir(resolve(storageRoot, "jobs"), {recursive: true, mode: 0o700});
    await mkdir(resolve(storageRoot, "uploads"), {recursive: true, mode: 0o700});
};
