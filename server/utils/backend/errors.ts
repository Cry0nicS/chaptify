import type {PublicProcessingErrorCode} from "../../../shared/utils/types";

const PUBLIC_ERROR_MESSAGES: Record<PublicProcessingErrorCode, string> = {
    UNSUPPORTED_FILE_TYPE: "Only MP3 and M4B audiobooks are supported.",
    FILE_TOO_LARGE: "The uploaded audiobook is larger than the configured limit.",
    INVALID_AUDIO_FILE: "The uploaded file could not be read as a valid audio file.",
    NO_AUDIO_STREAM: "The uploaded file does not contain a supported audio stream.",
    NO_CHAPTERS_FOUND: "No embedded chapter metadata was found in this audiobook.",
    INVALID_CHAPTER_METADATA: "The audiobook contains invalid chapter metadata.",
    PROCESSING_FAILED: "The audiobook could not be processed.",
    ZIP_CREATION_FAILED: "The chapter archive could not be created.",
    STORAGE_CAPACITY_EXCEEDED: "There is not enough server storage available right now.",
    QUEUE_CAPACITY_EXCEEDED: "The processing queue is full. Please try again later."
};

export class PublicJobError extends Error {
    public readonly code: PublicProcessingErrorCode;
    public readonly publicMessage: string;

    public constructor(code: PublicProcessingErrorCode, diagnostic?: string) {
        super(diagnostic || PUBLIC_ERROR_MESSAGES[code]);
        this.code = code;
        this.publicMessage = PUBLIC_ERROR_MESSAGES[code];
    }
}

export const serializePublicError = (code: PublicProcessingErrorCode | null | undefined) => {
    if (!code) {
        return null;
    }

    return {
        code,
        message: PUBLIC_ERROR_MESSAGES[code]
    };
};
