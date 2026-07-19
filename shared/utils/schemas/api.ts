import {z} from "zod";
import {
    CONTACT_MESSAGE_MAX_LENGTH,
    CONTACT_MESSAGE_MIN_LENGTH,
    CONTACT_NAME_MAX_LENGTH,
    CONTACT_TOPICS,
    OUTPUT_FORMATS,
    PUBLIC_EMAIL_STATUSES,
    PUBLIC_JOB_STATUSES,
    PUBLIC_PROCESSING_ERROR_CODES
} from "../constants/api";

export const outputFormatSchema = z.enum(OUTPUT_FORMATS);

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

export const contactTopicSchema = z.enum(CONTACT_TOPICS);

export const contactRequestSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Enter your name.")
        .max(CONTACT_NAME_MAX_LENGTH, "Please keep your name shorter."),
    email: z.string().trim().email("Enter a valid email address.").max(320),
    topic: z.enum(CONTACT_TOPICS, {message: "Pick a topic."}),
    message: z
        .string()
        .trim()
        .min(CONTACT_MESSAGE_MIN_LENGTH, "Tell us a bit more — at least 10 characters.")
        .max(CONTACT_MESSAGE_MAX_LENGTH, "Please keep the message under 4000 characters.")
});

export const contactResponseSchema = z.object({
    status: z.literal("sent")
});

export const uploadMetadataSchema = z.object({
    email: z.string().email().max(320),
    fileName: z.string().min(1).max(255),
    fileSize: z.number().int().positive(),
    extension: z.enum(["mp3", "m4b"]),
    outputFormat: outputFormatSchema
});
