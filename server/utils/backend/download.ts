import type {JobRecord} from "./jobs-repository";
import {basename} from "node:path";

const stripAudioExtension = (name: string): string => name.replace(/\.(mp3|m4b)$/i, "");

/**
 * Chooses the user-facing download filename and content-type for a ready job's artifact.
 *
 * Split jobs serve the ZIP under its on-disk name; convert jobs serve a single audio file named
 * after the original upload with the target extension (the on-disk name is an internal fixed one),
 * so the user gets "My Book.mp3" rather than the internal "converted.mp3".
 */
export const describeJobDownload = (job: JobRecord): {filename: string; contentType: string} => {
    if (job.kind === "convert") {
        const base = stripAudioExtension(job.displayFilename) || "audio";

        return {
            filename: `${base}.${job.outputFormat}`,
            contentType: job.outputFormat === "mp3" ? "audio/mpeg" : "audio/mp4"
        };
    }

    return {
        filename: basename(job.outputPath ?? ""),
        contentType: "application/zip"
    };
};
