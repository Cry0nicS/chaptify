export const PUBLIC_JOB_STATUSES = ["queued", "processing", "ready", "failed", "expired"] as const;

export const PUBLIC_EMAIL_STATUSES = ["pending", "sent", "failed"] as const;

export const PUBLIC_PROCESSING_ERROR_CODES = [
    "UNSUPPORTED_FILE_TYPE",
    "FILE_TOO_LARGE",
    "INVALID_AUDIO_FILE",
    "NO_AUDIO_STREAM",
    "NO_CHAPTERS_FOUND",
    "INVALID_CHAPTER_METADATA",
    "PROCESSING_FAILED",
    "ZIP_CREATION_FAILED",
    "STORAGE_CAPACITY_EXCEEDED",
    "QUEUE_CAPACITY_EXCEEDED"
] as const;

export const DEFAULT_JOB_RETENTION_HOURS = 12;
