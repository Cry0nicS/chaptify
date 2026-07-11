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
    workerConcurrency: numericEnvSchema(1, 1),
    jobRetentionHours: numericEnvSchema(12, 1),
    emailRetryAttempts: numericEnvSchema(3, 0),
    mailgunBaseUrl: z.string().optional().default(""),
    mailgunDomain: z.string().optional().default(""),
    mailgunKey: z.string().optional().default(""),
    mailgunSender: z.string().email().optional().or(z.literal("")),
    mailgunRecipient: z.string().email().optional().or(z.literal("")),
    mailgunBcc: z.string().email().optional().or(z.literal(""))
});

export type BackendConfig = z.infer<typeof runtimeConfigSchema>;

export const getBackendConfigFromEnv = (): BackendConfig =>
    runtimeConfigSchema.parse({
        appBaseUrl:
            process.env.CHAPTIFY_APP_BASE_URL ||
            process.env.NUXT_APP_BASE_URL ||
            "http://localhost:3000",
        storageRoot: process.env.NUXT_STORAGE_ROOT || DEFAULT_STORAGE_ROOT,
        maxUploadBytes: process.env.NUXT_MAX_UPLOAD_BYTES,
        maxQueuedJobs: process.env.NUXT_MAX_QUEUED_JOBS,
        workerConcurrency: process.env.NUXT_WORKER_CONCURRENCY,
        jobRetentionHours: process.env.NUXT_JOB_RETENTION_HOURS,
        emailRetryAttempts: process.env.NUXT_EMAIL_RETRY_ATTEMPTS,
        mailgunBaseUrl: process.env.NUXT_MAILGUN_BASE_URL || "",
        mailgunDomain: process.env.NUXT_MAILGUN_DOMAIN || "",
        mailgunKey: process.env.NUXT_MAILGUN_KEY || "",
        mailgunSender: process.env.NUXT_MAILGUN_SENDER || "",
        mailgunRecipient: process.env.NUXT_MAILGUN_RECIPIENT || "",
        mailgunBcc: process.env.NUXT_MAILGUN_BCC || ""
    });

export const getBackendConfig = (): BackendConfig => {
    const runtimeConfig = typeof useRuntimeConfig === "function" ? useRuntimeConfig() : {};
    const values = runtimeConfig as Record<string, unknown>;

    return runtimeConfigSchema.parse({
        appBaseUrl:
            process.env.CHAPTIFY_APP_BASE_URL ||
            process.env.NUXT_APP_BASE_URL ||
            values.appBaseUrl ||
            "http://localhost:3000",
        storageRoot: values.storageRoot || process.env.NUXT_STORAGE_ROOT || DEFAULT_STORAGE_ROOT,
        maxUploadBytes: values.maxUploadBytes || process.env.NUXT_MAX_UPLOAD_BYTES,
        maxQueuedJobs: values.maxQueuedJobs || process.env.NUXT_MAX_QUEUED_JOBS,
        workerConcurrency: values.workerConcurrency || process.env.NUXT_WORKER_CONCURRENCY,
        jobRetentionHours: values.jobRetentionHours || process.env.NUXT_JOB_RETENTION_HOURS,
        emailRetryAttempts: values.emailRetryAttempts || process.env.NUXT_EMAIL_RETRY_ATTEMPTS,
        mailgunBaseUrl: values.mailgunBaseUrl || process.env.NUXT_MAILGUN_BASE_URL || "",
        mailgunDomain: values.mailgunDomain || process.env.NUXT_MAILGUN_DOMAIN || "",
        mailgunKey: values.mailgunKey || process.env.NUXT_MAILGUN_KEY || "",
        mailgunSender: values.mailgunSender || process.env.NUXT_MAILGUN_SENDER || "",
        mailgunRecipient: values.mailgunRecipient || process.env.NUXT_MAILGUN_RECIPIENT || "",
        mailgunBcc: values.mailgunBcc || process.env.NUXT_MAILGUN_BCC || ""
    });
};

export const normalizeBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/, "");

export const ensureStorageRoot = async (storageRoot: string) => {
    await mkdir(resolve(storageRoot, "database"), {recursive: true, mode: 0o700});
    await mkdir(resolve(storageRoot, "jobs"), {recursive: true, mode: 0o700});
    await mkdir(resolve(storageRoot, "uploads"), {recursive: true, mode: 0o700});
};
