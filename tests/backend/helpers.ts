import type {BackendConfig} from "../../server/utils/backend/config";
import {mkdtemp, readFile, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, expect, vi} from "vitest";
import {ensureStorageRoot} from "../../server/utils/backend/config";
import {
    createJobRepository,
    openDatabase,
    resetDatabaseForTests
} from "../../server/utils/backend/database";
import {hashBrowserJobAccessToken} from "../../server/utils/backend/ids";
import {runProcess} from "../../server/utils/backend/process";
import {resetRateLimitsForTests} from "../../server/utils/backend/rate-limits";
import {DEFAULT_JOB_RETENTION_HOURS} from "../../shared/utils/constants";

/**
 * Installs the shared per-test cleanup every backend test file needs: the SQLite singleton and
 * in-memory rate limits are process-wide, so they must reset between tests.
 */
export const registerBackendTestHooks = () => {
    afterEach(() => {
        resetDatabaseForTests();
        resetRateLimitsForTests();
        vi.clearAllMocks();
    });
};

export const makeStorageRoot = async () => {
    const root = await mkdtemp(join(tmpdir(), "chaptify-test-"));
    await ensureStorageRoot(root);

    return root;
};

export const makeConfig = (storageRoot: string): BackendConfig => ({
    siteUrl: "http://localhost:3000",
    storageRoot,
    maxUploadBytes: 1024,
    maxQueuedJobs: 10,
    maxConcurrentUploads: 2,
    uploadIdleTimeoutSeconds: 30,
    trustProxy: "",
    perIpUploadLimit: 5,
    perIpJobLimit: 5,
    downloadRateLimit: 30,
    storageReservationMultiplier: 4,
    storageReservationSafetyBytes: 0,
    storageReservationTtlMinutes: 30,
    orphanJobDirectoryMinAgeMinutes: 30,
    cleanupIntervalSeconds: 300,
    browserDownloadGrantLifetimeSeconds: 60,
    browserDownloadGrantUsedGraceSeconds: 300,
    workerConcurrency: 1,
    jobRetentionHours: DEFAULT_JOB_RETENTION_HOURS,
    maxAudiobookDurationSeconds: 86_400,
    maxChapters: 300,
    jobProcessingTimeoutSeconds: 14_400,
    ffprobeTimeoutSeconds: 30,
    ffmpegChapterTimeoutSeconds: 1_200,
    emailRetryAttempts: 3,
    downloadSigningSecret: "test-signing-secret-with-at-least-32-characters",
    emailRetryBaseDelaySeconds: 1,
    emailRetryMaxDelaySeconds: 2,
    mailgunBaseUrl: "https://api.mailgun.test",
    mailgunDomain: "example.test",
    mailgunKey: "key-test",
    mailgunSender: "sender@example.test",
    mailgunBcc: "",
    contactRecipient: "operator@example.test",
    contactRateLimit: 5
});

export const createRepository = async () => {
    const storageRoot = await makeStorageRoot();
    const database = openDatabase(storageRoot);
    const jobs = createJobRepository(database);

    return {storageRoot, database, jobs};
};

export const createQueuedJob = (
    jobs: ReturnType<typeof createJobRepository>,
    storageRoot: string
) => {
    jobs.createJob({
        publicJobId: "public-job-id",
        internalId: "internal-job-id",
        displayFilename: "Book.m4b",
        sourceFormat: "m4b",
        outputFormat: "m4b",
        fileSize: 100,
        email: "reader@example.test",
        sourcePath: join(storageRoot, "jobs", "internal-job-id", "source", "source.m4b"),
        createdAt: new Date().toISOString(),
        browserJobAccessTokenHash: hashBrowserJobAccessToken("browser-token")
    });
};

export const requireFfmpeg = async () => {
    await expect(runProcess("ffmpeg", ["-version"], 10_000)).resolves.toBeDefined();
    await expect(runProcess("ffprobe", ["-version"], 10_000)).resolves.toBeDefined();
};

export const writeChapterMetadata = async (path: string) => {
    await writeFile(
        path,
        [
            ";FFMETADATA1",
            "title=Synthetic Book",
            "artist=Synthetic Author",
            "",
            "[CHAPTER]",
            "TIMEBASE=1/1000",
            "START=0",
            "END=2000",
            "title=Intro/One",
            "",
            "[CHAPTER]",
            "TIMEBASE=1/1000",
            "START=2000",
            "END=4000",
            "title=Second: Part"
        ].join("\n")
    );
};

export const createSyntheticAudiobook = async (
    root: string,
    format: "mp3" | "m4b"
): Promise<string> => {
    await requireFfmpeg();
    const basePath = join(root, `base.${format}`);
    const metadataPath = join(root, "chapters.ffmetadata");
    const outputPath = join(root, `synthetic.${format}`);
    await writeChapterMetadata(metadataPath);

    await runProcess(
        "ffmpeg",
        [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=4",
            "-vn",
            "-sn",
            "-dn",
            "-c:a",
            format === "mp3" ? "libmp3lame" : "aac",
            basePath
        ],
        30_000
    );
    await runProcess(
        "ffmpeg",
        [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            basePath,
            "-i",
            metadataPath,
            "-map_metadata",
            "1",
            "-map_chapters",
            "1",
            "-c",
            "copy",
            outputPath
        ],
        30_000
    );

    return outputPath;
};

export const probeMedia = async (path: string) => {
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
            path
        ],
        30_000
    );

    return JSON.parse(result.stdout) as {
        streams: Array<{codec_type?: string; codec_name?: string}>;
        chapters?: unknown[];
        format: {duration?: string; tags?: Record<string, string>};
    };
};

export const listZipEntries = async (zipPath: string): Promise<string[]> => {
    const zipCentralDirectoryHeader = 33_639_248;
    const bytes = await readFile(zipPath);
    const entries: string[] = [];
    let offset = 0;

    while (offset < bytes.length - 46) {
        if (bytes.readUInt32LE(offset) === zipCentralDirectoryHeader) {
            const nameLength = bytes.readUInt16LE(offset + 28);
            const extraLength = bytes.readUInt16LE(offset + 30);
            const commentLength = bytes.readUInt16LE(offset + 32);
            entries.push(bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
            offset += 46 + nameLength + extraLength + commentLength;
            continue;
        }

        offset += 1;
    }

    return entries;
};
