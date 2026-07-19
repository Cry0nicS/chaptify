import type {z} from "zod";
import type {
    browserDownloadGrantResponseSchema,
    browserDownloadRequestSchema,
    contactRequestSchema,
    contactResponseSchema,
    contactTopicSchema,
    jobStatusResponseSchema,
    outputFormatSchema,
    publicEmailStatusSchema,
    publicJobStatusSchema,
    publicProcessingErrorCodeSchema,
    publicProcessingErrorSchema,
    uploadJobResponseSchema,
    uploadMetadataSchema
} from "../schemas/api";

export type OutputFormat = z.infer<typeof outputFormatSchema>;

export type PublicJobStatus = z.infer<typeof publicJobStatusSchema>;
export type PublicEmailStatus = z.infer<typeof publicEmailStatusSchema>;
export type PublicProcessingErrorCode = z.infer<typeof publicProcessingErrorCodeSchema>;
export type PublicProcessingError = z.infer<typeof publicProcessingErrorSchema>;
export type UploadJobResponse = z.infer<typeof uploadJobResponseSchema>;
export type BrowserDownloadRequest = z.infer<typeof browserDownloadRequestSchema>;
export type BrowserDownloadGrantResponse = z.infer<typeof browserDownloadGrantResponseSchema>;
export type JobStatusResponse = z.infer<typeof jobStatusResponseSchema>;
export type UploadMetadata = z.infer<typeof uploadMetadataSchema>;
export type ContactTopic = z.infer<typeof contactTopicSchema>;
export type ContactRequest = z.infer<typeof contactRequestSchema>;
export type ContactResponse = z.infer<typeof contactResponseSchema>;
