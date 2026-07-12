import {mkdir, readdir, rm, stat} from "node:fs/promises";
import {join} from "node:path";
import {z} from "zod";
import {PublicJobError} from "./errors";
import {buildChapterFilenames, ensurePathInside} from "./paths";
import {runProcess} from "./process";

const MAX_CHAPTERS = 300;
const FFPROBE_TIMEOUT_MS = 30_000;
const FFMPEG_TIMEOUT_MS = 20 * 60_000;

const ffprobeChapterSchema = z.object({
    start_time: z.coerce.number(),
    end_time: z.coerce.number(),
    tags: z
        .object({
            title: z.string().optional()
        })
        .optional()
});

const ffprobeOutputSchema = z.object({
    streams: z.array(
        z.object({
            codec_type: z.string().optional(),
            codec_name: z.string().optional()
        })
    ),
    format: z.object({
        duration: z.coerce.number(),
        format_name: z.string().optional(),
        tags: z.record(z.string(), z.unknown()).optional()
    }),
    chapters: z.array(ffprobeChapterSchema).optional().default([])
});

export interface ChapterInfo {
    title: string | null;
    start: number;
    end: number;
}

export interface MediaInspection {
    duration: number;
    audioCodec: string;
    chapters: ChapterInfo[];
    outputExtension: "mp3" | "m4a";
    bookTitle: string | null;
}

const chooseOutputExtension = (
    audioCodec: string,
    formatName: string | undefined
): "mp3" | "m4a" => {
    const formats = new Set((formatName || "").split(","));

    if (audioCodec === "mp3" && formats.has("mp3")) {
        return "mp3";
    }

    if (
        audioCodec === "aac" &&
        ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"].some((name) => formats.has(name))
    ) {
        return "m4a";
    }

    throw new PublicJobError(
        "UNSUPPORTED_FILE_TYPE",
        `Unsupported codec/container: ${audioCodec}/${formatName || "unknown"}`
    );
};

/**
 * Validates chapter ranges before any FFmpeg output paths are created.
 *
 * Chapters must be ordered, non-overlapping, positive-length ranges inside the probed duration.
 * A small end-time tolerance accounts for container rounding in embedded chapter metadata.
 */
export const validateChapters = (chapters: ChapterInfo[], duration: number): void => {
    let previousStart = -1;
    let previousEnd = 0;

    for (const chapter of chapters) {
        if (
            !Number.isFinite(chapter.start) ||
            !Number.isFinite(chapter.end) ||
            chapter.start < 0 ||
            chapter.end <= chapter.start ||
            chapter.end > duration + 0.25 ||
            chapter.start < previousStart ||
            chapter.start < previousEnd
        ) {
            throw new PublicJobError("INVALID_CHAPTER_METADATA");
        }

        previousStart = chapter.start;
        previousEnd = chapter.end;
    }
};

/**
 * Reads trusted media facts from ffprobe and converts them to Chaptify's processing plan.
 *
 * The first audio stream determines whether the file is processable, while embedded chapters are
 * the only supported split source. The output extension follows the uploaded container because
 * chapter splitting uses stream copy instead of re-encoding.
 */
export const inspectAudioFile = async (
    sourcePath: string,
    _sourceFormat: "mp3" | "m4b"
): Promise<MediaInspection> => {
    let parsed: z.infer<typeof ffprobeOutputSchema>;

    try {
        const result = await runProcess(
            "ffprobe",
            [
                "-v",
                "error",
                "-show_format",
                "-show_streams",
                "-show_chapters",
                "-print_format",
                "json",
                sourcePath
            ],
            FFPROBE_TIMEOUT_MS
        );
        parsed = ffprobeOutputSchema.parse(JSON.parse(result.stdout));
    } catch (error) {
        throw new PublicJobError("INVALID_AUDIO_FILE", String(error));
    }

    const audioStream = parsed.streams.find((stream) => stream.codec_type === "audio");
    if (!audioStream?.codec_name) {
        throw new PublicJobError("NO_AUDIO_STREAM");
    }

    if (!Number.isFinite(parsed.format.duration) || parsed.format.duration <= 0) {
        throw new PublicJobError("INVALID_AUDIO_FILE");
    }

    if (parsed.chapters.length === 0) {
        throw new PublicJobError("NO_CHAPTERS_FOUND");
    }

    if (parsed.chapters.length > MAX_CHAPTERS) {
        throw new PublicJobError("INVALID_CHAPTER_METADATA", "Too many chapters");
    }

    const chapters = parsed.chapters.map((chapter) => ({
        title: chapter.tags?.title || null,
        start: chapter.start_time,
        end: chapter.end_time
    }));

    validateChapters(chapters, parsed.format.duration);
    const bookTitle =
        typeof parsed.format.tags?.title === "string" && parsed.format.tags.title.trim()
            ? parsed.format.tags.title.trim()
            : null;

    return {
        duration: parsed.format.duration,
        audioCodec: audioStream.codec_name,
        chapters,
        outputExtension: chooseOutputExtension(audioStream.codec_name, parsed.format.format_name),
        bookTitle
    };
};

const verifyChapterOutput = async (
    outputPath: string,
    chapter: ChapterInfo,
    expectedTitle: string,
    expectedTrack: string
) => {
    const result = await runProcess(
        "ffprobe",
        [
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-show_chapters",
            "-print_format",
            "json",
            outputPath
        ],
        FFPROBE_TIMEOUT_MS
    );
    const parsed = ffprobeOutputSchema.parse(JSON.parse(result.stdout));
    const audioStreams = parsed.streams.filter((stream) => stream.codec_type === "audio");
    const nonAudioStreams = parsed.streams.filter((stream) => stream.codec_type !== "audio");
    const duration = parsed.format.duration;
    const requestedDuration = chapter.end - chapter.start;
    const tags = parsed.format.tags || {};

    if (audioStreams.length !== 1 || nonAudioStreams.length > 0) {
        throw new Error("Chapter output stream layout was invalid");
    }

    if (parsed.chapters.length > 0) {
        throw new Error("Chapter output inherited an embedded chapter table");
    }

    if (!Number.isFinite(duration) || Math.abs(duration - requestedDuration) > 1.5) {
        throw new Error("Chapter output duration did not match the requested range");
    }

    if (tags.title !== expectedTitle || tags.track !== expectedTrack) {
        throw new Error("Chapter output metadata was invalid");
    }
};

/**
 * Stream-copies one output file per validated chapter.
 *
 * FFmpeg receives an argument array, maps only the first audio stream, and drops video, subtitle,
 * and data streams from chapter files. If any chapter fails or produces an empty file, all partial
 * chapter output is removed before the public processing failure is reported.
 */
export const splitChapters = async (
    storageRoot: string,
    sourcePath: string,
    chaptersDirectory: string,
    inspection: MediaInspection,
    onChapterComplete: (currentChapter: number, totalChapters: number) => void
): Promise<string[]> => {
    const safeChapterDirectory = ensurePathInside(storageRoot, chaptersDirectory);
    await mkdir(safeChapterDirectory, {recursive: true, mode: 0o700});
    const filenames = buildChapterFilenames(
        inspection.chapters.map((chapter) => chapter.title),
        inspection.outputExtension
    );
    const outputPaths: string[] = [];

    try {
        for (const [index, chapter] of inspection.chapters.entries()) {
            const filename = filenames[index];
            if (!filename) {
                throw new Error("Missing chapter filename");
            }

            const outputPath = ensurePathInside(storageRoot, join(safeChapterDirectory, filename));
            const chapterTitle = filename.slice(
                filename.indexOf(" - ") + 3,
                -`.${inspection.outputExtension}`.length
            );
            const track = `${index + 1}/${inspection.chapters.length}`;
            const metadataArgs = inspection.bookTitle
                ? ["-metadata", `album=${inspection.bookTitle}`]
                : [];
            await runProcess(
                "ffmpeg",
                [
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-ss",
                    String(chapter.start),
                    "-to",
                    String(chapter.end),
                    "-i",
                    sourcePath,
                    "-map",
                    "0:a:0",
                    "-map_chapters",
                    "-1",
                    "-map_metadata",
                    "-1",
                    "-vn",
                    "-sn",
                    "-dn",
                    "-c:a",
                    "copy",
                    "-metadata",
                    `title=${chapterTitle}`,
                    "-metadata",
                    `track=${track}`,
                    ...metadataArgs,
                    outputPath
                ],
                FFMPEG_TIMEOUT_MS
            );
            const outputStats = await stat(outputPath);
            if (outputStats.size === 0) {
                throw new Error("Empty chapter output");
            }
            await verifyChapterOutput(outputPath, chapter, chapterTitle, track);

            outputPaths.push(outputPath);
            onChapterComplete(index + 1, inspection.chapters.length);
        }
    } catch (error) {
        await rm(safeChapterDirectory, {recursive: true, force: true});
        throw new PublicJobError("PROCESSING_FAILED", String(error));
    }

    return outputPaths;
};

export const listChapterFilesInOrder = async (chaptersDirectory: string): Promise<string[]> => {
    const entries = await readdir(chaptersDirectory);

    return entries.sort().map((entry) => join(chaptersDirectory, entry));
};
