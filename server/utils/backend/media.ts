import type {OutputFormat} from "../../../shared/utils/types";
import {mkdir, rm, stat} from "node:fs/promises";
import {join} from "node:path";
import {z} from "zod";
import {PublicJobError} from "./errors";
import {buildChapterFilenames, ensurePathInside} from "./paths";
import {runProcess} from "./process";

/**
 * Per output-format encoding plan. `codec` is the ffprobe codec name a source must already have for
 * a stream copy; when the source codec differs, the chapter is re-encoded with `encodeArgs`.
 */
const OUTPUT_SPECS: Record<
    OutputFormat,
    {codec: string; extension: "mp3" | "m4b"; encodeArgs: string[]; muxArgs: string[]}
> = {
    mp3: {
        codec: "mp3",
        extension: "mp3",
        encodeArgs: ["-c:a", "libmp3lame", "-b:a", "128k"],
        muxArgs: []
    },
    m4b: {
        codec: "aac",
        extension: "m4b",
        encodeArgs: ["-c:a", "aac", "-b:a", "128k"],
        muxArgs: ["-movflags", "+faststart"]
    }
};

const DEFAULT_MEDIA_LIMITS = {
    maxAudiobookDurationSeconds: 86_400,
    maxChapters: 300,
    ffprobeTimeoutMs: 30_000,
    ffmpegChapterTimeoutMs: 20 * 60_000
};

export interface MediaProcessingOptions {
    maxAudiobookDurationSeconds?: number;
    maxChapters?: number;
    ffprobeTimeoutMs?: number;
    ffmpegChapterTimeoutMs?: number;
    deadlineMs?: number;
    signal?: AbortSignal;
}

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
    bookTitle: string | null;
    author: string | null;
}

/** Reads a non-empty string tag case-insensitively; ffprobe tag casing varies by container. */
const readFormatTag = (tags: Record<string, unknown> | undefined, name: string): string | null => {
    for (const [key, value] of Object.entries(tags || {})) {
        if (key.toLowerCase() === name && typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }

    return null;
};

const limitsWithDefaults = (options: MediaProcessingOptions = {}) => ({
    maxAudiobookDurationSeconds:
        options.maxAudiobookDurationSeconds ?? DEFAULT_MEDIA_LIMITS.maxAudiobookDurationSeconds,
    maxChapters: options.maxChapters ?? DEFAULT_MEDIA_LIMITS.maxChapters,
    ffprobeTimeoutMs: options.ffprobeTimeoutMs ?? DEFAULT_MEDIA_LIMITS.ffprobeTimeoutMs,
    ffmpegChapterTimeoutMs:
        options.ffmpegChapterTimeoutMs ?? DEFAULT_MEDIA_LIMITS.ffmpegChapterTimeoutMs
});

const remainingTimeoutMs = (timeoutMs: number, deadlineMs?: number): number => {
    if (!deadlineMs) {
        return timeoutMs;
    }

    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) {
        throw new PublicJobError("PROCESSING_FAILED", "Processing deadline exceeded");
    }

    return Math.min(timeoutMs, remaining);
};

/**
 * Rejects uploads whose codec/container combination Chaptify does not process. Only MP3 audio in an
 * MP3 container and AAC audio in an MP4/M4B-style container are accepted as split sources.
 */
const assertSupportedInput = (audioCodec: string, formatName: string | undefined): void => {
    const formats = new Set((formatName || "").split(","));

    if (audioCodec === "mp3" && formats.has("mp3")) {
        return;
    }

    // ffprobe reports every MP4-family container (including .m4b) with the shared demuxer name
    // "mov,mp4,m4a,3gp,3g2,mj2"; these tokens match that string and are not file extensions.
    if (
        audioCodec === "aac" &&
        ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"].some((name) => formats.has(name))
    ) {
        return;
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
 * the only supported split source. The probed audio codec later decides whether `splitChapters`
 * can stream-copy into the requested output format or must re-encode.
 */
export const inspectAudioFile = async (
    sourcePath: string,
    _sourceFormat: "mp3" | "m4b",
    options: MediaProcessingOptions = {}
): Promise<MediaInspection> => {
    let parsed: z.infer<typeof ffprobeOutputSchema>;
    const limits = limitsWithDefaults(options);

    try {
        const result = await runProcess(
            "ffprobe",
            [
                "-v",
                "error",
                // Restrict to the local file protocol so a crafted upload (e.g. a disguised HLS or
                // concat playlist) cannot make ffprobe open http/tcp/udp/ftp or other resources.
                "-protocol_whitelist",
                "file",
                "-show_format",
                "-show_streams",
                "-show_chapters",
                "-print_format",
                "json",
                sourcePath
            ],
            remainingTimeoutMs(limits.ffprobeTimeoutMs, options.deadlineMs),
            options.signal
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

    if (parsed.format.duration > limits.maxAudiobookDurationSeconds) {
        throw new PublicJobError(
            "PROCESSING_FAILED",
            "Audiobook duration exceeds configured limit"
        );
    }

    if (parsed.chapters.length === 0) {
        throw new PublicJobError("NO_CHAPTERS_FOUND");
    }

    if (parsed.chapters.length > limits.maxChapters) {
        throw new PublicJobError("INVALID_CHAPTER_METADATA", "Too many chapters");
    }

    const chapters = parsed.chapters.map((chapter) => ({
        title: chapter.tags?.title || null,
        start: chapter.start_time,
        end: chapter.end_time
    }));

    validateChapters(chapters, parsed.format.duration);
    assertSupportedInput(audioStream.codec_name, parsed.format.format_name);
    const bookTitle = readFormatTag(parsed.format.tags, "title");
    const author =
        readFormatTag(parsed.format.tags, "artist") ??
        readFormatTag(parsed.format.tags, "album_artist") ??
        readFormatTag(parsed.format.tags, "author");

    return {
        duration: parsed.format.duration,
        audioCodec: audioStream.codec_name,
        chapters,
        bookTitle,
        author
    };
};

const verifyChapterOutput = async (
    outputPath: string,
    chapter: ChapterInfo,
    expectedTitle: string,
    expectedTrack: string,
    options: MediaProcessingOptions
) => {
    const limits = limitsWithDefaults(options);
    const result = await runProcess(
        "ffprobe",
        [
            "-v",
            "error",
            "-protocol_whitelist",
            "file",
            "-show_format",
            "-show_streams",
            "-show_chapters",
            "-print_format",
            "json",
            outputPath
        ],
        remainingTimeoutMs(limits.ffprobeTimeoutMs, options.deadlineMs),
        options.signal
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
 * Writes one output file per validated chapter in the requested output format.
 *
 * FFmpeg receives an argument array, maps only the first audio stream, and drops video, subtitle,
 * and data streams from chapter files. When the source codec already matches the requested format
 * the audio is stream-copied; otherwise it is re-encoded (mp3 <-> aac). Each chapter is cut with a
 * fast input-side `-ss` seek plus an explicit output-side `-t` duration (`end - start`) rather than
 * `-to`, whose meaning as an input option is FFmpeg-version-dependent; this keeps chapter lengths
 * stable across builds. If any chapter fails or produces an empty file, all partial chapter output
 * is removed before the public processing failure is reported.
 */
export const splitChapters = async (
    storageRoot: string,
    sourcePath: string,
    chaptersDirectory: string,
    inspection: MediaInspection,
    outputFormat: OutputFormat,
    onChapterComplete: (currentChapter: number, totalChapters: number) => void,
    options: MediaProcessingOptions = {}
): Promise<string[]> => {
    const limits = limitsWithDefaults(options);
    const spec = OUTPUT_SPECS[outputFormat];
    const streamCopy = inspection.audioCodec === spec.codec;
    const codecArgs = streamCopy ? ["-c:a", "copy"] : spec.encodeArgs;
    const safeChapterDirectory = ensurePathInside(storageRoot, chaptersDirectory);
    await mkdir(safeChapterDirectory, {recursive: true, mode: 0o700});
    const filenames = buildChapterFilenames(
        inspection.chapters.map((chapter) => chapter.title),
        spec.extension
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
                -`.${spec.extension}`.length
            );
            const track = `${index + 1}/${inspection.chapters.length}`;
            const metadataArgs = inspection.bookTitle
                ? ["-metadata", `album=${inspection.bookTitle}`]
                : [];

            try {
                await runProcess(
                    "ffmpeg",
                    [
                        // Never read stdin, and restrict to the local file protocol so a crafted
                        // input cannot make ffmpeg open external (http/tcp/udp/ftp/...) resources.
                        "-nostdin",
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-y",
                        "-protocol_whitelist",
                        "file",
                        "-ss",
                        String(chapter.start),
                        "-i",
                        sourcePath,
                        "-t",
                        String(chapter.end - chapter.start),
                        "-map",
                        "0:a:0",
                        "-map_chapters",
                        "-1",
                        "-map_metadata",
                        "-1",
                        "-vn",
                        "-sn",
                        "-dn",
                        ...codecArgs,
                        ...spec.muxArgs,
                        "-metadata",
                        `title=${chapterTitle}`,
                        "-metadata",
                        `track=${track}`,
                        ...metadataArgs,
                        outputPath
                    ],
                    remainingTimeoutMs(limits.ffmpegChapterTimeoutMs, options.deadlineMs),
                    options.signal
                );
                const outputStats = await stat(outputPath);
                if (outputStats.size === 0) {
                    throw new Error("Empty chapter output");
                }
                await verifyChapterOutput(outputPath, chapter, chapterTitle, track, options);
            } catch (error) {
                // Attach chapter context so a single bad boundary is diagnosable in internal logs
                // instead of surfacing only as a blanket processing failure.
                throw new Error(
                    `Chapter ${track} "${chapterTitle}": ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
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
