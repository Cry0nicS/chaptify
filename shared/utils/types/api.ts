import type {z} from "zod";
import type {
    jobStatusResponseSchema,
    publicEmailStatusSchema,
    publicJobStatusSchema,
    publicProcessingErrorCodeSchema,
    publicProcessingErrorSchema,
    uploadJobResponseSchema,
    uploadMetadataSchema
} from "../schemas/api";

export type PublicJobStatus = z.infer<typeof publicJobStatusSchema>;
export type PublicEmailStatus = z.infer<typeof publicEmailStatusSchema>;
export type PublicProcessingErrorCode = z.infer<typeof publicProcessingErrorCodeSchema>;
export type PublicProcessingError = z.infer<typeof publicProcessingErrorSchema>;
export type UploadJobResponse = z.infer<typeof uploadJobResponseSchema>;
export type JobStatusResponse = z.infer<typeof jobStatusResponseSchema>;
export type UploadMetadata = z.infer<typeof uploadMetadataSchema>;
