import {uploadMetadataSchema} from "#shared/utils/schemas";

export const SUPPORTED_AUDIOBOOK_EXTENSIONS = ["mp3", "m4b"] as const;

export type SupportedAudiobookExtension = (typeof SUPPORTED_AUDIOBOOK_EXTENSIONS)[number];

export interface FileValidationResult {
    valid: boolean;
    extension: SupportedAudiobookExtension | null;
    message: string | null;
}

const extensionPattern = /\.([^.]+)$/;

export const getAudiobookExtension = (fileName: string): SupportedAudiobookExtension | null => {
    const extension = extensionPattern.exec(fileName)?.[1]?.toLowerCase();

    return extension === "mp3" || extension === "m4b" ? extension : null;
};

export const validateAudiobookFile = (file: File | null | undefined): FileValidationResult => {
    if (!file) {
        return {
            valid: false,
            extension: null,
            message: "Choose one M4B or MP3 audiobook."
        };
    }

    const extension = getAudiobookExtension(file.name);

    if (!extension) {
        return {
            valid: false,
            extension: null,
            message: "Choose an audiobook in M4B or MP3 format."
        };
    }

    const parsed = uploadMetadataSchema
        .pick({
            fileName: true,
            fileSize: true,
            extension: true
        })
        .safeParse({
            fileName: file.name,
            fileSize: file.size,
            extension
        });

    if (!parsed.success) {
        return {
            valid: false,
            extension,
            message: "Choose a non-empty audiobook file with a shorter filename."
        };
    }

    return {
        valid: true,
        extension,
        message: null
    };
};
