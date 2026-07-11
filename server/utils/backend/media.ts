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
        duration: z.coerce.number()
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
}

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

export const inspectAudioFile = async (
    sourcePath: string,
    sourceFormat: "mp3" | "m4b"
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

    return {
        duration: parsed.format.duration,
        audioCodec: audioStream.codec_name,
        chapters,
        outputExtension: sourceFormat === "mp3" ? "mp3" : "m4a"
    };
};

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
                    "-vn",
                    "-sn",
                    "-dn",
                    "-c:a",
                    "copy",
                    outputPath
                ],
                FFMPEG_TIMEOUT_MS
            );
            const outputStats = await stat(outputPath);
            if (outputStats.size === 0) {
                throw new Error("Empty chapter output");
            }

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
