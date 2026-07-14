import {z} from "zod";
import {
    PUBLIC_EMAIL_STATUSES,
    PUBLIC_JOB_STATUSES,
    PUBLIC_PROCESSING_ERROR_CODES
} from "../constants/api";

export const publicJobStatusSchema = z.enum(PUBLIC_JOB_STATUSES);

export const publicEmailStatusSchema = z.enum(PUBLIC_EMAIL_STATUSES);

export const publicProcessingErrorCodeSchema = z.enum(PUBLIC_PROCESSING_ERROR_CODES);

export const publicProcessingErrorSchema = z.object({
    code: publicProcessingErrorCodeSchema,
    message: z.string().min(1)
});

const browserJobAccessTokenSchema = z
    .string()
    .min(32)
    .regex(/^[\w-]+$/);

export const uploadJobResponseSchema = z.object({
    jobId: z.string().min(16),
    status: z.literal("queued"),
    createdAt: z.string().datetime(),
    jobAccessToken: browserJobAccessTokenSchema
});

export const browserDownloadRequestSchema = z.object({
    jobAccessToken: browserJobAccessTokenSchema
});

export const browserDownloadGrantResponseSchema = z.object({
    downloadUrl: z.string().min(1)
});

export const jobStatusResponseSchema = z.object({
    jobId: z.string().min(16),
    status: publicJobStatusSchema,
    progress: z.number().int().min(0).max(100),
    currentChapter: z.number().int().min(0).nullable(),
    totalChapters: z.number().int().min(0).nullable(),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable(),
    emailStatus: publicEmailStatusSchema,
    error: publicProcessingErrorSchema.nullable()
});

export const uploadMetadataSchema = z.object({
    email: z.string().email().max(320),
    fileName: z.string().min(1).max(255),
    fileSize: z.number().int().positive(),
    extension: z.enum(["mp3", "m4b"])
});
