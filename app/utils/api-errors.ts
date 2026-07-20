import type {PublicProcessingError, PublicProcessingErrorCode} from "#shared/utils/types";
import {publicProcessingErrorSchema} from "#shared/utils/schemas";

export interface FrontendApiError {
    code: PublicProcessingErrorCode | "INVALID_UPLOAD" | "NETWORK_ERROR" | "UNKNOWN_ERROR";
    message: string;
    guidance: string;
    statusCode?: number;
}

const ERROR_GUIDANCE: Record<PublicProcessingErrorCode, string> = {
    UNSUPPORTED_FILE_TYPE: "Choose an audiobook in M4B or MP3 format.",
    FILE_TOO_LARGE: "This file exceeds the current upload limit. Choose a smaller audiobook.",
    INVALID_AUDIO_FILE:
        "The file could not be read as a valid audiobook. It may be damaged or use an unsupported encoding.",
    NO_AUDIO_STREAM: "The file does not contain a supported audio stream.",
    NO_CHAPTERS_FOUND:
        "No embedded chapter markers were found. Re-upload with “Split into 30-minute parts” enabled to process it as timed segments instead.",
    AUDIOBOOK_TOO_SHORT:
        "This file is too short to split into timed parts. The fixed-length fallback is only available for longer audiobooks.",
    INVALID_CHAPTER_METADATA:
        "The audiobook contains chapter information that could not be processed safely.",
    PROCESSING_FAILED:
        "The audiobook could not be processed. You can try again with a different file.",
    ZIP_CREATION_FAILED:
        "The chapter files were created, but the ZIP archive could not be prepared safely.",
    STORAGE_CAPACITY_EXCEEDED:
        "The server does not currently have enough temporary storage to process this audiobook. Try again later.",
    QUEUE_CAPACITY_EXCEEDED:
        "The service is currently processing the maximum number of audiobooks. Try again later."
};

export const guidanceForErrorCode = (
    code: PublicProcessingErrorCode | "INVALID_UPLOAD" | "NETWORK_ERROR" | "UNKNOWN_ERROR"
): string => {
    if (code === "INVALID_UPLOAD") {
        return "Check the selected file and email address, then try again.";
    }

    if (code === "NETWORK_ERROR") {
        return "Check your connection. The upload was not completed.";
    }

    if (code === "UNKNOWN_ERROR") {
        return "Something went wrong. Please start over and try again.";
    }

    return ERROR_GUIDANCE[code];
};

const getNestedError = (value: unknown): unknown => {
    if (!value || typeof value !== "object") {
        return null;
    }

    const record = value as Record<string, unknown>;

    return record.error || (record.data as Record<string, unknown> | undefined)?.error || null;
};

export const parsePublicError = (value: unknown): PublicProcessingError | null => {
    const parsed = publicProcessingErrorSchema.safeParse(getNestedError(value));

    return parsed.success ? parsed.data : null;
};

export const toFrontendApiError = (
    value: unknown,
    fallbackMessage = "The request could not be completed."
): FrontendApiError => {
    const publicError = parsePublicError(value);

    if (publicError) {
        return {
            code: publicError.code,
            message: publicError.message,
            guidance: guidanceForErrorCode(publicError.code)
        };
    }

    return {
        code: "UNKNOWN_ERROR",
        message: fallbackMessage,
        guidance: guidanceForErrorCode("UNKNOWN_ERROR")
    };
};
