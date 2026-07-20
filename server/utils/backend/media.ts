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
    fallbackSegmentSeconds: 1_800,
    minSegmentedDurationSeconds: 3_600,
    ffprobeTimeoutMs: 30_000,
    ffmpegChapterTimeoutMs: 20 * 60_000
};

/**
 * A trailing segment shorter than this is folded into the previous part instead of becoming its
 * own file, so fixed-length splitting never produces a pointless few-second final "Part".
 */
const SEGMENT_TAIL_MERGE_SECONDS = 60;

export interface MediaProcessingOptions {
    maxAudiobookDurationSeconds?: number;
    maxChapters?: number;
    ffprobeTimeoutMs?: number;
    ffmpegChapterTimeoutMs?: number;
    deadlineMs?: number;
    signal?: AbortSignal;
    /** When true and the file has no embedded chapters, split it into fixed-length segments. */
    segmentWithoutChapters?: boolean;
    fallbackSegmentSeconds?: number;
    minSegmentedDurationSeconds?: number;
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
    /** True when `chapters` were synthesized by fixed-length fallback rather than read from the file. */
    segmented: boolean;
}

/**
 * Divides a total duration into contiguous fixed-length parts titled "Part N".
 *
 * A trailing part shorter than SEGMENT_TAIL_MERGE_SECONDS is merged into the one before it so the
 * split never ends on a sliver. Callers must guarantee `duration > 0` and `segmentSeconds > 0`.
 */
export const synthesizeSegments = (duration: number, segmentSeconds: number): ChapterInfo[] => {
    const segments: ChapterInfo[] = [];
    let start = 0;

    while (start < duration) {
        const end = Math.min(start + segmentSeconds, duration);
        segments.push({title: `Part ${segments.length + 1}`, start, end});
        start = end;
    }

    const lastSegment = segments.at(-1);
    if (
        segments.length >= 2 &&
        lastSegment &&
        lastSegment.end - lastSegment.start < SEGMENT_TAIL_MERGE_SECONDS
    ) {
        const previous = segments[segments.length - 2]!;
        previous.end = lastSegment.end;
        segments.pop();
    }

    return segments;
};

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

    let segmented = false;
    let chapters: ChapterInfo[];

    if (parsed.chapters.length === 0) {
        // No embedded chapters. Either fail (default) or, when the caller opted in and the file is
        // long enough to be a real audiobook, split it into fixed-length parts instead.
        if (!options.segmentWithoutChapters) {
            throw new PublicJobError("NO_CHAPTERS_FOUND");
        }

        const minSegmentedDurationSeconds =
            options.minSegmentedDurationSeconds ?? DEFAULT_MEDIA_LIMITS.minSegmentedDurationSeconds;
        if (parsed.format.duration < minSegmentedDurationSeconds) {
            throw new PublicJobError("AUDIOBOOK_TOO_SHORT");
        }

        const fallbackSegmentSeconds =
            options.fallbackSegmentSeconds ?? DEFAULT_MEDIA_LIMITS.fallbackSegmentSeconds;
        chapters = synthesizeSegments(parsed.format.duration, fallbackSegmentSeconds);
        segmented = true;
    } else {
        chapters = parsed.chapters.map((chapter) => ({
            title: chapter.tags?.title || null,
            start: chapter.start_time,
            end: chapter.end_time
        }));
    }

    if (chapters.length > limits.maxChapters) {
        throw new PublicJobError("INVALID_CHAPTER_METADATA", "Too many chapters");
    }

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
        author,
        segmented
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

/** A whole-file convert can run far longer than one chapter cut, so it leans on the job deadline. */
const MAX_CONVERT_TIMEOUT_MS = 24 * 60 * 60_000;

export interface ConversionProbe {
    duration: number;
    audioCodec: string;
    chapterCount: number;
    bookTitle: string | null;
    author: string | null;
    /** True when the source carries an embedded cover (an attached-picture video stream). */
    hasCoverArt: boolean;
}

/**
 * Lightweight probe for the standalone converter.
 *
 * Unlike `inspectAudioFile`, this intentionally does NOT require chapters or a minimum duration —
 * conversion works on any valid mp3/m4b (songs, clips, audiobooks). It still enforces the same
 * codec/container support and the upper duration cap, and it fails cheaply so a corrupt or
 * mislabeled upload never reaches the expensive transcode.
 */
export const probeForConversion = async (
    sourcePath: string,
    options: MediaProcessingOptions = {}
): Promise<ConversionProbe> => {
    const limits = limitsWithDefaults(options);
    let parsed: z.infer<typeof ffprobeOutputSchema>;

    try {
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
        throw new PublicJobError("PROCESSING_FAILED", "Audio duration exceeds configured limit");
    }

    assertSupportedInput(audioStream.codec_name, parsed.format.format_name);

    return {
        duration: parsed.format.duration,
        audioCodec: audioStream.codec_name,
        chapterCount: parsed.chapters.length,
        bookTitle: readFormatTag(parsed.format.tags, "title"),
        author:
            readFormatTag(parsed.format.tags, "artist") ??
            readFormatTag(parsed.format.tags, "album_artist") ??
            readFormatTag(parsed.format.tags, "author"),
        hasCoverArt: parsed.streams.some((stream) => stream.codec_type === "video")
    };
};

/**
 * Transcodes the whole file to `outputFormat` as a faithful repackage.
 *
 * Because mp3 and m4b never share a codec, this always re-encodes (no stream copy). Unlike the
 * chapter split — which deliberately strips everything — conversion preserves the source's global
 * metadata (`-map_metadata 0`), embedded chapters (`-map_chapters 0`), and cover art (the attached
 * picture stream, copied through when present). The output is written to a fixed, safe on-disk name;
 * the user-facing filename is derived from the display name at download time.
 */
export const convertAudio = async (
    storageRoot: string,
    sourcePath: string,
    outputDirectory: string,
    outputFormat: OutputFormat,
    hasCoverArt: boolean,
    options: MediaProcessingOptions = {}
): Promise<string> => {
    const spec = OUTPUT_SPECS[outputFormat];
    const safeOutputDirectory = ensurePathInside(storageRoot, outputDirectory);
    await mkdir(safeOutputDirectory, {recursive: true, mode: 0o700});
    const outputPath = ensurePathInside(
        storageRoot,
        join(safeOutputDirectory, `converted.${spec.extension}`)
    );

    // Copy the attached-picture stream through only when the source actually has one; mapping a
    // missing stream (or setting its disposition) otherwise makes ffmpeg fail.
    const coverArgs = hasCoverArt
        ? ["-map", "0:v:0?", "-c:v", "copy", "-disposition:v:0", "attached_pic"]
        : [];
    // id3v2 v3 makes the preserved tags and cover widely readable in mp3 players.
    const id3Args = outputFormat === "mp3" ? ["-id3v2_version", "3"] : [];

    try {
        await runProcess(
            "ffmpeg",
            [
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-protocol_whitelist",
                "file",
                "-i",
                sourcePath,
                "-map",
                "0:a:0",
                ...coverArgs,
                "-map_metadata",
                "0",
                "-map_chapters",
                "0",
                ...spec.encodeArgs,
                ...spec.muxArgs,
                ...id3Args,
                outputPath
            ],
            remainingTimeoutMs(MAX_CONVERT_TIMEOUT_MS, options.deadlineMs),
            options.signal
        );
        const outputStats = await stat(outputPath);
        if (outputStats.size === 0) {
            throw new Error("Empty converted output");
        }
    } catch (error) {
        await rm(safeOutputDirectory, {recursive: true, force: true});
        throw new PublicJobError("PROCESSING_FAILED", String(error));
    }

    return outputPath;
};
