import {createWriteStream} from "node:fs";
import {rm, stat} from "node:fs/promises";
import {basename, join} from "node:path";
import {ZipArchive} from "archiver";
import {PublicJobError} from "./errors";
import {ensurePathInside} from "./paths";

/**
 * Streams chapter files into the final ZIP archive under the job output directory.
 *
 * The archive is finalized through the output stream instead of buffering file contents in memory.
 * Empty or partially-created archives are deleted before surfacing a public ZIP failure.
 */
export const createChapterZip = async (
    storageRoot: string,
    outputDirectory: string,
    archiveName: string,
    chapterPaths: string[]
): Promise<string> => {
    const zipPath = ensurePathInside(storageRoot, join(outputDirectory, archiveName));

    try {
        await new Promise<void>((resolve, reject) => {
            const archive = new ZipArchive({zlib: {level: 9}});
            const output = createWriteStream(zipPath, {mode: 0o600});

            output.on("close", resolve);
            output.on("error", reject);
            archive.on("error", reject);
            archive.pipe(output);

            for (const chapterPath of chapterPaths) {
                archive.file(chapterPath, {name: basename(chapterPath)});
            }

            void archive.finalize();
        });

        const stats = await stat(zipPath);
        if (stats.size === 0) {
            throw new Error("ZIP archive was empty");
        }

        return zipPath;
    } catch (error) {
        await rm(zipPath, {force: true});
        throw new PublicJobError("ZIP_CREATION_FAILED", String(error));
    }
};
