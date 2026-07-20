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
    siteUrl: z.string().url().optional().or(z.literal("")),
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
    // No-chapters fallback: segment length, and the minimum duration that qualifies a file as an
    // audiobook eligible for it (guards against splitting a song into pointless parts).
    fallbackSegmentSeconds: numericEnvSchema(1_800, 1),
    minSegmentedDurationSeconds: numericEnvSchema(3_600, 1),
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
    mailgunBcc: z.string().email().optional().or(z.literal("")),
    contactRecipient: z.string().email().optional().or(z.literal("")),
    contactRateLimit: numericEnvSchema(5, 1)
});

export type BackendConfig = z.infer<typeof runtimeConfigSchema>;

const CONFIG_KEYS = Object.keys(runtimeConfigSchema.shape) as (keyof BackendConfig)[];

/**
 * Maps a camelCase config key to its environment variable, e.g. `maxUploadBytes` ->
 * `NUXT_MAX_UPLOAD_BYTES`. This is the same convention Nuxt itself uses for runtimeConfig env
 * overrides, so every key stays reachable under one predictable name in both runtimes.
 */
const envVarName = (key: string): string =>
    `NUXT_${key.replaceAll(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`;

/**
 * Fallbacks applied when neither runtime config nor the environment provides a value. Numeric
 * keys are absent on purpose: `numericEnvSchema` already supplies their defaults during parsing.
 */
const CONFIG_FALLBACKS: Partial<Record<keyof BackendConfig, string>> = {
    siteUrl: "http://localhost:3000",
    storageRoot: DEFAULT_STORAGE_ROOT,
    trustProxy: "",
    downloadSigningSecret: "",
    mailgunBaseUrl: "",
    mailgunDomain: "",
    mailgunKey: "",
    mailgunSender: "",
    mailgunBcc: "",
    contactRecipient: ""
};

/**
 * Returns the first source value that is actually set.
 *
 * Like `a || b || c` for the string inputs this config uses, but treats only `undefined`, `null`,
 * and `""` as unset — so a legitimate `0` from one source is not silently discarded in favour of a
 * later fallback.
 */
const pick = (...values: unknown[]): unknown =>
    values.find((value) => value !== undefined && value !== null && value !== "");

const buildConfig = (runtimeValues: Record<string, unknown>): BackendConfig =>
    runtimeConfigSchema.parse(
        Object.fromEntries(
            CONFIG_KEYS.map((key) => [
                key,
                pick(runtimeValues[key], process.env[envVarName(key)], CONFIG_FALLBACKS[key])
            ])
        )
    );

/**
 * Reads backend configuration for the standalone worker/cleanup processes.
 *
 * These do not run inside Nuxt's runtime config container, so they depend on environment
 * variables (loaded from `.env` by `loadDotenv` when present) at the time this is called.
 */
export const getBackendConfigFromEnv = (): BackendConfig => buildConfig({});

/**
 * Reads backend configuration inside Nitro while preserving worker-compatible env fallbacks, so
 * environment values can still override runtime config during Docker starts.
 */
export const getBackendConfig = (): BackendConfig =>
    buildConfig(
        typeof useRuntimeConfig === "function"
            ? (useRuntimeConfig() as Record<string, unknown>)
            : {}
    );

export const normalizeBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/, "");

/**
 * Fails fast when a production process is missing configuration its core features require.
 *
 * Outside production this is a no-op so local development keeps working with lenient defaults. A
 * missing signing secret (needed to sign/verify download links) is always fatal. Mailgun config is
 * only required by processes that actually send email (the worker), so pass `requireMailgun` there.
 *
 * A localhost `siteUrl` is only a warning: emailed links would not work for external recipients
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

    if (!config.siteUrl) {
        problems.push("NUXT_SITE_URL must be set to the public application origin");
    } else if (/localhost|127\.0\.0\.1|::1/i.test(config.siteUrl)) {
        console.warn(
            "NUXT_SITE_URL is a localhost origin; emailed download links will not work for external recipients"
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
