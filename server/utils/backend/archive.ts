import {createWriteStream} from "node:fs";
import {rm, stat} from "node:fs/promises";
import {basename, join} from "node:path";
import {ZipArchive} from "archiver";
import {PublicJobError} from "./errors";
import {ensurePathInside} from "./paths";

export interface CreateChapterZipOptions {
    signal?: AbortSignal;
    beforeFinalize?: () => Promise<void> | void;
}

/**
 * Streams chapter files into the final ZIP archive under the job output directory.
 *
 * The archive is finalized through the output stream instead of buffering file contents in memory.
 * `statConcurrency: 1` forces archiver to stat and append entries serially so the ZIP preserves the
 * caller's chapter order; with the default concurrent stat, a smaller/faster chapter can overtake a
 * larger earlier one and land out of order in the archive. Empty or partially-created archives are
 * deleted before surfacing a public ZIP failure.
 */
export const createChapterZip = async (
    storageRoot: string,
    outputDirectory: string,
    archiveName: string,
    chapterPaths: string[],
    options: CreateChapterZipOptions = {}
): Promise<string> => {
    const zipPath = ensurePathInside(storageRoot, join(outputDirectory, archiveName));

    try {
        await new Promise<void>((resolve, reject) => {
            const archive = new ZipArchive({zlib: {level: 9}, statConcurrency: 1});
            const output = createWriteStream(zipPath, {mode: 0o600});
            let settled = false;

            function abort() {
                fail(new PublicJobError("PROCESSING_FAILED", "ZIP creation deadline exceeded"));
            }

            function cleanup() {
                options.signal?.removeEventListener("abort", abort);
            }

            function fail(error: unknown) {
                if (settled) {
                    return;
                }

                settled = true;
                cleanup();
                archive.abort();
                output.destroy();
                reject(error);
            }

            function done() {
                if (settled) {
                    return;
                }

                settled = true;
                cleanup();
                resolve();
            }

            if (options.signal?.aborted) {
                abort();
                return;
            }

            options.signal?.addEventListener("abort", abort, {once: true});

            output.on("close", done);
            output.on("error", fail);
            archive.on("error", fail);
            archive.pipe(output);

            for (const chapterPath of chapterPaths) {
                archive.file(chapterPath, {name: basename(chapterPath)});
            }

            void Promise.resolve(options.beforeFinalize?.())
                .then(() => {
                    if (options.signal?.aborted) {
                        abort();
                        return;
                    }

                    void archive.finalize();
                })
                .catch(fail);
        });

        const stats = await stat(zipPath);
        if (stats.size === 0) {
            throw new Error("ZIP archive was empty");
        }

        return zipPath;
    } catch (error) {
        await rm(zipPath, {force: true});
        if (error instanceof PublicJobError) {
            throw error;
        }

        throw new PublicJobError("ZIP_CREATION_FAILED", String(error));
    }
};
