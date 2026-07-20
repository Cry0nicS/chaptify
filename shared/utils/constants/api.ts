export const PUBLIC_JOB_STATUSES = ["queued", "processing", "ready", "failed", "expired"] as const;

export const PUBLIC_EMAIL_STATUSES = ["pending", "sent", "failed"] as const;

export const OUTPUT_FORMATS = ["mp3", "m4b"] as const;

export const PUBLIC_PROCESSING_ERROR_CODES = [
    "UNSUPPORTED_FILE_TYPE",
    "FILE_TOO_LARGE",
    "INVALID_AUDIO_FILE",
    "NO_AUDIO_STREAM",
    "NO_CHAPTERS_FOUND",
    "AUDIOBOOK_TOO_SHORT",
    "INVALID_CHAPTER_METADATA",
    "PROCESSING_FAILED",
    "ZIP_CREATION_FAILED",
    "STORAGE_CAPACITY_EXCEEDED",
    "QUEUE_CAPACITY_EXCEEDED"
] as const;

export const DEFAULT_JOB_RETENTION_HOURS = 12;

export const CONTACT_TOPICS = ["feature", "bug", "other"] as const;

export const CONTACT_NAME_MAX_LENGTH = 100;

export const CONTACT_MESSAGE_MIN_LENGTH = 10;

export const CONTACT_MESSAGE_MAX_LENGTH = 4000;
