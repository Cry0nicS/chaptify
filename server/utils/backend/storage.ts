import {mkdir, rename, stat, statfs} from "node:fs/promises";
import {dirname, extname, join} from "node:path";
import {createInternalId} from "./ids";
import {ensurePathInside, jobDirectory, safeRemoveInside, sanitizeDisplayFilename} from "./paths";

export interface StoredUpload {
    internalId: string;
    sourcePath: string;
    sourceFormat: "mp3" | "m4b";
    displayFilename: string;
    fileSize: number;
}

export const detectUploadExtension = (filename: string): "mp3" | "m4b" | null => {
    const extension = extname(filename).toLowerCase().replace(".", "");

    if (extension === "mp3" || extension === "m4b") {
        return extension;
    }

    return null;
};

export const ensureEnoughStorage = async (
    storageRoot: string,
    requiredBytes: number
): Promise<boolean> => {
    try {
        const stats = await statfs(storageRoot);
        const availableBytes = Number(stats.bavail) * Number(stats.bsize);

        return availableBytes > requiredBytes * 2;
    } catch {
        return true;
    }
};

/**
 * Moves a completed multipart upload into its private job directory.
 *
 * The browser-provided filename is used only to infer the allowed extension and create a sanitized
 * display name. Internal storage paths are generated from a random internal ID and kept inside the
 * configured storage root.
 */
export const createJobStorage = async (
    storageRoot: string,
    tempUploadPath: string,
    originalFilename: string
): Promise<StoredUpload> => {
    const sourceFormat = detectUploadExtension(originalFilename);

    if (!sourceFormat) {
        await safeRemoveInside(storageRoot, tempUploadPath);
        throw new Error("UNSUPPORTED_FILE_TYPE");
    }

    const stats = await stat(tempUploadPath);
    const internalId = createInternalId();
    const directory = jobDirectory(storageRoot, internalId);
    const sourceDirectory = ensurePathInside(storageRoot, join(directory, "source"));
    const chaptersDirectory = ensurePathInside(storageRoot, join(directory, "chapters"));
    const outputDirectory = ensurePathInside(storageRoot, join(directory, "output"));
    await mkdir(sourceDirectory, {recursive: true, mode: 0o700});
    await mkdir(chaptersDirectory, {recursive: true, mode: 0o700});
    await mkdir(outputDirectory, {recursive: true, mode: 0o700});

    const sourcePath = ensurePathInside(
        storageRoot,
        join(sourceDirectory, `source.${sourceFormat}`)
    );
    await mkdir(dirname(sourcePath), {recursive: true, mode: 0o700});
    await rename(tempUploadPath, sourcePath);

    return {
        internalId,
        sourcePath,
        sourceFormat,
        displayFilename: sanitizeDisplayFilename(originalFilename),
        fileSize: stats.size
    };
};

/**
 * Removes all files for a job directory, if it exists.
 *
 * The path is resolved through storage-root safety checks, making this safe to call repeatedly from
 * cleanup, failure, and expiry paths.
 */
export const cleanupJobFiles = async (storageRoot: string, internalId: string): Promise<void> => {
    await safeRemoveInside(storageRoot, jobDirectory(storageRoot, internalId));
};
