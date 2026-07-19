import type {BackendConfig} from "../server/utils/backend/config";
import {Buffer} from "node:buffer";
import {spawn} from "node:child_process";
import {access, mkdir, mkdtemp, readFile, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from "vitest";
import {createChapterZip} from "../server/utils/backend/archive";
import {runCleanup} from "../server/utils/backend/cleanup";
import {
    ensureStorageRoot,
    getBackendConfigFromEnv,
    validateProductionConfig
} from "../server/utils/backend/config";
import {
    createJobRepository,
    openDatabase,
    resetDatabaseForTests
} from "../server/utils/backend/database";
import {loadDotenv, parseDotenv} from "../server/utils/backend/env";
import {PublicJobError, serializePublicError} from "../server/utils/backend/errors";
import {
    createBrowserDownloadGrantToken,
    createBrowserJobAccessToken,
    createDownloadToken,
    createSignedDownloadToken,
    hashBrowserDownloadGrantToken,
    hashBrowserJobAccessToken,
    hashDownloadToken,
    verifySignedDownloadToken
} from "../server/utils/backend/ids";
import {createMailgunService} from "../server/utils/backend/mailgun";
import {inspectAudioFile, splitChapters, validateChapters} from "../server/utils/backend/media";
import {
    buildChapterFilenames,
    ensurePathInside,
    safeRemoveInside,
    sanitizeChapterTitle,
    sanitizeDisplayFilename
} from "../server/utils/backend/paths";
import {runProcess} from "../server/utils/backend/process";
import {
    checkUploadRateLimit,
    getClientIp,
    resetRateLimitsForTests
} from "../server/utils/backend/rate-limits";
import {
    deliverDueEmails,
    deliverReadyEmail,
    processJob,
    recoverInterruptedJobs
} from "../server/utils/backend/worker";
import {DEFAULT_JOB_RETENTION_HOURS} from "../shared/utils/constants";
import {contactRequestSchema, uploadMetadataSchema} from "../shared/utils/schemas";

vi.mock("mailgun.js", () => {
    const create = vi.fn();
    class MailgunMock {
        public client() {
            return {
                messages: {
                    create
                }
            };
        }
    }

    return {
        default: MailgunMock,
        __mailgunCreate: create
    };
});

const makeStorageRoot = async () => {
    const root = await mkdtemp(join(tmpdir(), "chaptify-test-"));
    await ensureStorageRoot(root);

    return root;
};

const makeConfig = (storageRoot: string): BackendConfig => ({
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
    mailgunRecipient: "",
    mailgunBcc: "",
    contactRecipient: "operator@example.test",
    contactRateLimit: 5
});

const createRepository = async () => {
    const storageRoot = await makeStorageRoot();
    const database = openDatabase(storageRoot);
    const jobs = createJobRepository(database);

    return {storageRoot, database, jobs};
};

const createQueuedJob = (jobs: ReturnType<typeof createJobRepository>, storageRoot: string) => {
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

const requireFfmpeg = async () => {
    await expect(runProcess("ffmpeg", ["-version"], 10_000)).resolves.toBeDefined();
    await expect(runProcess("ffprobe", ["-version"], 10_000)).resolves.toBeDefined();
};

const writeChapterMetadata = async (path: string) => {
    await writeFile(
        path,
        [
            ";FFMETADATA1",
            "title=Synthetic Book",
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

const createSyntheticAudiobook = async (root: string, format: "mp3" | "m4b"): Promise<string> => {
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

const probeMedia = async (path: string) => {
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

const listZipEntries = async (zipPath: string): Promise<string[]> => {
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

afterEach(() => {
    resetDatabaseForTests();
    resetRateLimitsForTests();
    vi.clearAllMocks();
});

describe("public validation and filenames", () => {
    it("validates submitted email and upload metadata", () => {
        expect(
            uploadMetadataSchema.parse({
                email: "reader@example.test",
                fileName: "book.mp3",
                fileSize: 1,
                extension: "mp3",
                outputFormat: "m4b"
            })
        ).toMatchObject({extension: "mp3", outputFormat: "m4b"});
        expect(() =>
            uploadMetadataSchema.parse({
                email: "not-an-email",
                fileName: "book.wav",
                fileSize: 0,
                extension: "wav"
            })
        ).toThrow();
    });

    it("sanitizes filenames and handles duplicate chapter names deterministically", () => {
        expect(sanitizeDisplayFilename("../CON")).toBe("audiobook");
        expect(sanitizeChapterTitle("Intro/Start", "Chapter 01")).toBe("Intro Start");
        expect(buildChapterFilenames(["Intro", "Intro", ""], "m4b")).toEqual([
            "01 - Intro.m4b",
            "02 - Intro (2).m4b",
            "03 - Chapter 03.m4b"
        ]);
    });

    it("serializes public processing errors without diagnostics", () => {
        expect(serializePublicError("NO_CHAPTERS_FOUND")).toEqual({
            code: "NO_CHAPTERS_FOUND",
            message: "No embedded chapter metadata was found in this audiobook."
        });
    });
});

describe("runtime environment loading", () => {
    it("parses dotenv values and ignores comments", () => {
        expect(
            parseDotenv(`
                # comment
                NUXT_MAILGUN_DOMAIN=mg.example.test
                NUXT_MAILGUN_KEY="key-test"
                NUXT_MAILGUN_SENDER='Chaptify <sender@example.test>'
                export NUXT_MAILGUN_BCC=bcc@example.test # optional recipient
            `)
        ).toEqual({
            NUXT_MAILGUN_DOMAIN: "mg.example.test",
            NUXT_MAILGUN_KEY: "key-test",
            NUXT_MAILGUN_SENDER: "Chaptify <sender@example.test>",
            NUXT_MAILGUN_BCC: "bcc@example.test"
        });
    });

    it("loads Mailgun values from .env without overriding shell values", async () => {
        const root = await mkdtemp(join(tmpdir(), "chaptify-env-"));
        await writeFile(
            join(root, ".env"),
            [
                "NUXT_SITE_URL=https://example.test",
                "NUXT_STORAGE_ROOT=/tmp/chaptify",
                "NUXT_MAILGUN_BASE_URL=https://api.mailgun.test",
                "NUXT_MAILGUN_DOMAIN=mg.example.test",
                "NUXT_MAILGUN_KEY=key-from-file",
                "NUXT_MAILGUN_SENDER=sender@example.test",
                "NUXT_MAILGUN_RECIPIENT=recipient@example.test"
            ].join("\n")
        );
        const env: NodeJS.ProcessEnv = {
            NUXT_MAILGUN_KEY: "key-from-shell"
        };

        loadDotenv(root, env);

        expect(env.NUXT_SITE_URL).toBe("https://example.test");
        expect(env.NUXT_MAILGUN_KEY).toBe("key-from-shell");
        expect(env.NUXT_MAILGUN_DOMAIN).toBe("mg.example.test");
    });

    it("keeps getBackendConfigFromEnv aligned with loaded Mailgun config", async () => {
        const root = await mkdtemp(join(tmpdir(), "chaptify-env-"));
        await writeFile(
            join(root, ".env"),
            [
                "NUXT_SITE_URL=https://example.test",
                "NUXT_STORAGE_ROOT=/tmp/chaptify",
                "NUXT_MAILGUN_BASE_URL=https://api.mailgun.test",
                "NUXT_MAILGUN_DOMAIN=mg.example.test",
                "NUXT_MAILGUN_KEY=key-test",
                "NUXT_MAILGUN_SENDER=sender@example.test"
            ].join("\n")
        );
        const previousEnv = {...process.env};

        try {
            process.env = {};
            loadDotenv(root);

            expect(getBackendConfigFromEnv()).toMatchObject({
                siteUrl: "https://example.test",
                mailgunBaseUrl: "https://api.mailgun.test",
                mailgunDomain: "mg.example.test",
                mailgunKey: "key-test",
                mailgunSender: "sender@example.test"
            });
        } finally {
            process.env = previousEnv;
        }
    });
});

describe("chapter metadata", () => {
    it("accepts ordered valid chapter ranges", () => {
        expect(() =>
            validateChapters(
                [
                    {title: "One", start: 0, end: 10},
                    {title: "Two", start: 10, end: 20}
                ],
                20
            )
        ).not.toThrow();
    });

    it("rejects invalid chapter ranges", () => {
        expect(() =>
            validateChapters(
                [
                    {title: "Bad", start: 5, end: 4},
                    {title: "Later", start: 4, end: 8}
                ],
                10
            )
        ).toThrow(PublicJobError);
    });

    it("rejects overlapping chapter ranges", () => {
        expect(() =>
            validateChapters(
                [
                    {title: "One", start: 0, end: 10},
                    {title: "Two", start: 9, end: 20}
                ],
                20
            )
        ).toThrow(PublicJobError);
    });
});

describe("synthetic ffmpeg end-to-end media", () => {
    it.each([
        // input, chosen output format, expected chapter extension, expected codec (copy or re-encode)
        ["mp3", "mp3", "mp3", "mp3"],
        ["m4b", "m4b", "m4b", "aac"],
        ["mp3", "m4b", "m4b", "aac"],
        ["m4b", "mp3", "mp3", "mp3"]
    ] as const)(
        "splits a generated %s audiobook to %s chapter outputs",
        async (inputFormat, outputFormat, outputExtension, expectedCodec) => {
            const root = await makeStorageRoot();
            const sourcePath = await createSyntheticAudiobook(root, inputFormat);
            const inspection = await inspectAudioFile(sourcePath, inputFormat);
            const chaptersDirectory = join(
                root,
                "jobs",
                `${inputFormat}-to-${outputFormat}`,
                "chapters"
            );
            const completed: Array<[number, number]> = [];

            expect(inspection.chapters).toHaveLength(2);

            const chapterPaths = await splitChapters(
                root,
                sourcePath,
                chaptersDirectory,
                inspection,
                outputFormat,
                (current, total) => completed.push([current, total])
            );

            expect(chapterPaths.map((path) => path.split(/[/\\]/).at(-1))).toEqual([
                `01 - Intro One.${outputExtension}`,
                `02 - Second Part.${outputExtension}`
            ]);
            expect(completed).toEqual([
                [1, 2],
                [2, 2]
            ]);

            for (const [index, chapterPath] of chapterPaths.entries()) {
                const probed = await probeMedia(chapterPath);
                const audioStreams = probed.streams.filter(
                    (stream) => stream.codec_type === "audio"
                );
                const nonAudioStreams = probed.streams.filter(
                    (stream) => stream.codec_type !== "audio"
                );
                const tags = probed.format.tags || {};

                expect(audioStreams).toHaveLength(1);
                expect(audioStreams[0]?.codec_name).toBe(expectedCodec);
                expect(nonAudioStreams).toHaveLength(0);
                expect(probed.chapters || []).toHaveLength(0);
                expect(Number(probed.format.duration)).toBeGreaterThan(1.5);
                expect(Number(probed.format.duration)).toBeLessThan(2.5);
                expect(tags.title).toBe(index === 0 ? "Intro One" : "Second Part");
                expect(tags.track).toBe(`${index + 1}/2`);
            }
        }
    );

    it.each(["mp3", "m4b"] as const)(
        "processes a generated %s job to a ready ZIP and removes source/intermediates",
        async (inputFormat) => {
            const storageRoot = await makeStorageRoot();
            const database = openDatabase(storageRoot);
            const jobs = createJobRepository(database);
            const sourceDirectory = join(storageRoot, "jobs", `${inputFormat}-job`, "source");
            await mkdir(sourceDirectory, {recursive: true});
            const sourcePath = join(sourceDirectory, `source.${inputFormat}`);
            const generatedPath = await createSyntheticAudiobook(storageRoot, inputFormat);
            await writeFile(sourcePath, await readFile(generatedPath));
            jobs.createJob({
                publicJobId: `${inputFormat}-public-job-id`,
                internalId: `${inputFormat}-job`,
                displayFilename: `Synthetic.${inputFormat}`,
                sourceFormat: inputFormat,
                outputFormat: inputFormat,
                fileSize: (await stat(sourcePath)).size,
                email: "reader@example.test",
                sourcePath,
                createdAt: new Date().toISOString(),
                browserJobAccessTokenHash: hashBrowserJobAccessToken("browser-token")
            });
            const claimed = jobs.claimQueuedJob(new Date().toISOString());

            if (!claimed) {
                throw new Error("Expected queued synthetic job to be claimed");
            }

            await processJob(makeConfig(storageRoot), jobs, claimed);

            const ready = jobs.findByInternalId(`${inputFormat}-job`);
            expect(ready?.status).toBe("ready");
            expect(ready?.zipPath).toEqual(expect.any(String));
            if (!ready?.zipPath || !ready.expiresAt) {
                throw new Error("Expected ready ZIP");
            }

            await expect(access(sourcePath)).rejects.toThrow();
            await expect(
                access(join(storageRoot, "jobs", `${inputFormat}-job`, "chapters"))
            ).rejects.toThrow();
            expect(await listZipEntries(ready.zipPath)).toEqual(
                inputFormat === "mp3"
                    ? ["01 - Intro One.mp3", "02 - Second Part.mp3"]
                    : ["01 - Intro One.m4b", "02 - Second Part.m4b"]
            );

            const signed = createSignedDownloadToken({
                publicJobId: ready.publicJobId,
                internalId: ready.internalId,
                expiresAt: ready.expiresAt,
                signingSecret: makeConfig(storageRoot).downloadSigningSecret || ""
            });
            expect(
                verifySignedDownloadToken({
                    token: signed,
                    internalId: ready.internalId,
                    expiresAt: ready.expiresAt,
                    signingSecret: makeConfig(storageRoot).downloadSigningSecret || ""
                })
            ).toBe(true);
            expect(
                verifySignedDownloadToken({
                    token: signed,
                    internalId: "wrong-job",
                    expiresAt: ready.expiresAt,
                    signingSecret: makeConfig(storageRoot).downloadSigningSecret || ""
                })
            ).toBe(false);

            database
                .prepare("UPDATE jobs SET expires_at = ? WHERE internal_id = ?")
                .run("2026-07-11T00:00:00.000Z", ready.internalId);
            await runCleanup(makeConfig(storageRoot), jobs);
            await expect(access(ready.zipPath)).rejects.toThrow();
        }
    );
});

describe("chapter archive ordering", () => {
    it("preserves chapter order regardless of per-file size", async () => {
        const root = await makeStorageRoot();
        const outputDirectory = join(root, "jobs", "zip-order", "output");
        const chaptersDirectory = join(root, "jobs", "zip-order", "chapters");
        await mkdir(outputDirectory, {recursive: true});
        await mkdir(chaptersDirectory, {recursive: true});

        // A large first chapter followed by tiny later chapters is the layout that made archiver's
        // concurrent stat float the smaller files ahead; the ordered names must survive it.
        const chapterPaths: string[] = [];
        for (const [index, size] of [900_000, 20_000, 20_000].entries()) {
            const name = `${String(index + 1).padStart(2, "0")} - Chapter ${index + 1}.m4b`;
            const chapterPath = join(chaptersDirectory, name);
            await writeFile(chapterPath, Buffer.alloc(size, index + 1));
            chapterPaths.push(chapterPath);
        }

        const expected = ["01 - Chapter 1.m4b", "02 - Chapter 2.m4b", "03 - Chapter 3.m4b"];

        // Rebuild several times so a nondeterministic reordering cannot pass by luck.
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const zipPath = await createChapterZip(
                root,
                outputDirectory,
                `chapters-${attempt}.zip`,
                chapterPaths
            );
            expect(await listZipEntries(zipPath)).toEqual(expected);
        }
    });
});

describe("tokens and persistence", () => {
    it("generates hash-only download token values", () => {
        const token = createDownloadToken();
        const hash = hashDownloadToken(token);

        expect(token).not.toBe(hash);
        expect(token.length).toBeGreaterThanOrEqual(40);
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("generates hash-only browser job access token values", () => {
        const token = createBrowserJobAccessToken();
        const hash = hashBrowserJobAccessToken(token);

        expect(token).not.toBe(hash);
        expect(token.length).toBeGreaterThanOrEqual(40);
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("creates deterministic signed download links that require the server secret", () => {
        const token = createSignedDownloadToken({
            publicJobId: "public-job-id",
            internalId: "internal-job-id",
            expiresAt: "2026-07-11T13:00:00.000Z",
            signingSecret: "test-signing-secret-with-at-least-32-characters"
        });

        expect(token).toBe(
            createSignedDownloadToken({
                publicJobId: "public-job-id",
                internalId: "internal-job-id",
                expiresAt: "2026-07-11T13:00:00.000Z",
                signingSecret: "test-signing-secret-with-at-least-32-characters"
            })
        );
        expect(
            verifySignedDownloadToken({
                token,
                internalId: "internal-job-id",
                expiresAt: "2026-07-11T13:00:00.000Z",
                signingSecret: "test-signing-secret-with-at-least-32-characters"
            })
        ).toBe(true);
        expect(
            verifySignedDownloadToken({
                token,
                internalId: "other-job-id",
                expiresAt: "2026-07-11T13:00:00.000Z",
                signingSecret: "test-signing-secret-with-at-least-32-characters"
            })
        ).toBe(false);
    });

    it("claims queued jobs atomically and updates state transitions", async () => {
        const {storageRoot, jobs} = await createRepository();
        createQueuedJob(jobs, storageRoot);

        const firstClaim = jobs.claimQueuedJob(new Date().toISOString());
        const secondClaim = jobs.claimQueuedJob(new Date().toISOString());

        expect(firstClaim?.status).toBe("processing");
        expect(secondClaim).toBeNull();

        jobs.markFailed(
            "internal-job-id",
            "PROCESSING_FAILED",
            "private diagnostic",
            new Date().toISOString()
        );
        expect(jobs.findByPublicId("public-job-id")?.status).toBe("failed");
    });

    it("removes interrupted worker artifacts before requeueing recoverable jobs", async () => {
        const {storageRoot, jobs} = await createRepository();
        const sourceDirectory = join(storageRoot, "jobs", "internal-job-id", "source");
        const chaptersDirectory = join(storageRoot, "jobs", "internal-job-id", "chapters");
        const outputDirectory = join(storageRoot, "jobs", "internal-job-id", "output");
        const sourcePath = join(sourceDirectory, "source.m4b");
        const chapterPath = join(chaptersDirectory, "partial.m4b");
        const outputPath = join(outputDirectory, "partial.zip");
        await mkdir(sourceDirectory, {recursive: true});
        await mkdir(chaptersDirectory, {recursive: true});
        await mkdir(outputDirectory, {recursive: true});
        await writeFile(sourcePath, "source");
        await writeFile(chapterPath, "partial");
        await writeFile(outputPath, "partial");
        createQueuedJob(jobs, storageRoot);
        jobs.claimQueuedJob(new Date().toISOString());

        await recoverInterruptedJobs(makeConfig(storageRoot), jobs);

        expect(jobs.findByPublicId("public-job-id")?.status).toBe("queued");
        await expect(access(sourcePath)).resolves.toBeUndefined();
        await expect(access(chapterPath)).rejects.toThrow();
        await expect(access(outputPath)).rejects.toThrow();
    });

    it("keeps ready ZIP and sends email when post-ready chapter cleanup fails", async () => {
        const {storageRoot, jobs} = await createRepository();
        createQueuedJob(jobs, storageRoot);
        jobs.createStorageReservationIfCapacity(
            {
                ownerId: "internal-job-id",
                reservedBytes: 80,
                createdAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 60_000).toISOString()
            },
            1000
        );
        const sourceDirectory = join(storageRoot, "jobs", "internal-job-id", "source");
        const sourcePath = join(sourceDirectory, "source.m4b");
        await mkdir(sourceDirectory, {recursive: true});
        await writeFile(sourcePath, "source");
        const claimed = jobs.claimQueuedJob(new Date().toISOString());
        if (!claimed) {
            throw new Error("Expected claimed job");
        }
        const deliverReadyEmailMock = vi.fn(async () => {});

        await processJob(makeConfig(storageRoot), jobs, claimed, {
            inspectAudioFile: async () => ({
                duration: 2,
                audioCodec: "aac",
                chapters: [{title: "Intro", start: 0, end: 2}],
                bookTitle: null
            }),
            splitChapters: async (_root, _source, chaptersDirectory) => {
                const chapterPath = join(chaptersDirectory, "01 - Intro.m4b");
                await writeFile(chapterPath, "chapter");

                return [chapterPath];
            },
            createChapterZip: async (_root, outputDirectory, archiveName) => {
                const zipPath = join(outputDirectory, archiveName);
                await writeFile(zipPath, "zip");

                return zipPath;
            },
            removePath: async (path, options) => {
                if (String(path).endsWith(join("chapters"))) {
                    throw new Error("chapter cleanup failed");
                }

                await rm(path, options);
            },
            deliverReadyEmail: deliverReadyEmailMock
        });

        const ready = jobs.findByInternalId("internal-job-id");
        expect(ready?.status).toBe("ready");
        expect(ready?.zipPath).toEqual(expect.any(String));
        await expect(access(ready?.zipPath || "")).resolves.toBeUndefined();
        expect(deliverReadyEmailMock).toHaveBeenCalledTimes(1);
        expect(jobs.getActiveStorageReservation("internal-job-id")).toBeDefined();
    });

    it("keeps ready ZIP and sends email when post-ready source cleanup fails", async () => {
        const {storageRoot, jobs} = await createRepository();
        createQueuedJob(jobs, storageRoot);
        const sourceDirectory = join(storageRoot, "jobs", "internal-job-id", "source");
        const sourcePath = join(sourceDirectory, "source.m4b");
        await mkdir(sourceDirectory, {recursive: true});
        await writeFile(sourcePath, "source");
        const claimed = jobs.claimQueuedJob(new Date().toISOString());
        if (!claimed) {
            throw new Error("Expected claimed job");
        }
        const deliverReadyEmailMock = vi.fn(async () => {});

        await processJob(makeConfig(storageRoot), jobs, claimed, {
            inspectAudioFile: async () => ({
                duration: 2,
                audioCodec: "aac",
                chapters: [{title: "Intro", start: 0, end: 2}],
                bookTitle: null
            }),
            splitChapters: async (_root, _source, chaptersDirectory) => {
                const chapterPath = join(chaptersDirectory, "01 - Intro.m4b");
                await writeFile(chapterPath, "chapter");

                return [chapterPath];
            },
            createChapterZip: async (_root, outputDirectory, archiveName) => {
                const zipPath = join(outputDirectory, archiveName);
                await writeFile(zipPath, "zip");

                return zipPath;
            },
            removePath: async (path, options) => {
                if (String(path) === sourcePath) {
                    throw new Error("source cleanup failed");
                }

                await rm(path, options);
            },
            deliverReadyEmail: deliverReadyEmailMock
        });

        const ready = jobs.findByInternalId("internal-job-id");
        expect(ready?.status).toBe("ready");
        await expect(access(ready?.zipPath || "")).resolves.toBeUndefined();
        expect(deliverReadyEmailMock).toHaveBeenCalledTimes(1);
    });

    it("does not delete files or send email when ready transition loses the race", async () => {
        const {storageRoot, jobs} = await createRepository();
        createQueuedJob(jobs, storageRoot);
        const sourceDirectory = join(storageRoot, "jobs", "internal-job-id", "source");
        const sourcePath = join(sourceDirectory, "source.m4b");
        await mkdir(sourceDirectory, {recursive: true});
        await writeFile(sourcePath, "source");
        const claimed = jobs.claimQueuedJob(new Date().toISOString());
        if (!claimed) {
            throw new Error("Expected claimed job");
        }
        const deliverReadyEmailMock = vi.fn(async () => {});
        const removePathMock = vi.fn(rm);

        await processJob(makeConfig(storageRoot), jobs, claimed, {
            inspectAudioFile: async () => ({
                duration: 2,
                audioCodec: "aac",
                chapters: [{title: "Intro", start: 0, end: 2}],
                bookTitle: null
            }),
            splitChapters: async (_root, _source, chaptersDirectory) => {
                const chapterPath = join(chaptersDirectory, "01 - Intro.m4b");
                await writeFile(chapterPath, "chapter");

                return [chapterPath];
            },
            createChapterZip: async (_root, outputDirectory, archiveName) => {
                const zipPath = join(outputDirectory, archiveName);
                await writeFile(zipPath, "zip");

                return zipPath;
            },
            beforeMarkReady: () => {
                jobs.markFailed(
                    "internal-job-id",
                    "PROCESSING_FAILED",
                    "changed elsewhere",
                    new Date().toISOString()
                );
            },
            removePath: removePathMock,
            deliverReadyEmail: deliverReadyEmailMock
        });

        expect(jobs.findByInternalId("internal-job-id")?.status).toBe("failed");
        expect(removePathMock).not.toHaveBeenCalled();
        expect(deliverReadyEmailMock).not.toHaveBeenCalled();
        await expect(access(sourcePath)).resolves.toBeUndefined();
    });

    it("applies the total processing deadline to ZIP finalization", async () => {
        const {storageRoot, jobs} = await createRepository();
        createQueuedJob(jobs, storageRoot);
        jobs.createStorageReservationIfCapacity(
            {
                ownerId: "internal-job-id",
                reservedBytes: 80,
                createdAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 60_000).toISOString()
            },
            1000
        );
        const sourceDirectory = join(storageRoot, "jobs", "internal-job-id", "source");
        const sourcePath = join(sourceDirectory, "source.m4b");
        await mkdir(sourceDirectory, {recursive: true});
        await writeFile(sourcePath, "source");
        const claimed = jobs.claimQueuedJob(new Date().toISOString());
        if (!claimed) {
            throw new Error("Expected claimed job");
        }

        await processJob(
            {...makeConfig(storageRoot), jobProcessingTimeoutSeconds: 1},
            jobs,
            claimed,
            {
                inspectAudioFile: async () => ({
                    duration: 2,
                    audioCodec: "aac",
                    chapters: [{title: "Intro", start: 0, end: 2}],
                    bookTitle: null
                }),
                splitChapters: async (_root, _source, chaptersDirectory) => {
                    const chapterPath = join(chaptersDirectory, "01 - Intro.m4b");
                    await writeFile(chapterPath, "chapter");

                    return [chapterPath];
                },
                createChapterZip: async (
                    root,
                    outputDirectory,
                    archiveName,
                    chapterPaths,
                    options
                ) =>
                    await createChapterZip(root, outputDirectory, archiveName, chapterPaths, {
                        signal: options?.signal,
                        beforeFinalize: async () =>
                            await new Promise<void>((resolve) => {
                                options?.signal?.addEventListener("abort", () => resolve(), {
                                    once: true
                                });
                            })
                    })
            }
        );

        const failed = jobs.findByInternalId("internal-job-id");
        expect(failed?.status).toBe("failed");
        await expect(
            access(join(storageRoot, "jobs", "internal-job-id", "output"))
        ).rejects.toThrow();
        expect(jobs.getActiveStorageReservation("internal-job-id")).toBeUndefined();
    });

    it("expires ready jobs and rejects expired token lookups", async () => {
        const {storageRoot, jobs} = await createRepository();
        createQueuedJob(jobs, storageRoot);
        jobs.claimQueuedJob(new Date().toISOString());
        jobs.markReady(
            "internal-job-id",
            join(storageRoot, "jobs", "internal-job-id", "output", "book.zip"),
            hashDownloadToken("token"),
            "2026-07-11T12:00:00.000Z",
            "2026-07-11T13:00:00.000Z"
        );

        expect(
            jobs.findReadyByTokenHash(hashDownloadToken("token"), "2026-07-11T12:30:00.000Z")
        ).not.toBeNull();
        expect(
            jobs.findReadyByTokenHash(hashDownloadToken("token"), "2026-07-11T13:00:00.000Z")
        ).toBeNull();
    });

    it("finds ready jobs by browser access token without using the download token", async () => {
        const {storageRoot, jobs} = await createRepository();
        createQueuedJob(jobs, storageRoot);
        jobs.claimQueuedJob(new Date().toISOString());
        jobs.markReady(
            "internal-job-id",
            join(storageRoot, "jobs", "internal-job-id", "output", "book.zip"),
            hashDownloadToken("download-token"),
            "2026-07-11T12:00:00.000Z",
            "2026-07-11T13:00:00.000Z"
        );

        expect(
            jobs.findReadyByBrowserAccess(
                "public-job-id",
                hashBrowserJobAccessToken("browser-token"),
                "2026-07-11T12:30:00.000Z"
            )?.publicJobId
        ).toBe("public-job-id");
        expect(
            jobs.findReadyByBrowserAccess(
                "public-job-id",
                hashBrowserJobAccessToken("download-token"),
                "2026-07-11T12:30:00.000Z"
            )
        ).toBeNull();

        jobs.markExpired("internal-job-id", "2026-07-11T13:00:00.000Z");
        expect(jobs.findByPublicId("public-job-id")?.browserJobAccessTokenHash).toBeNull();
    });

    it("purges used, expired, and expired-job browser download grants idempotently", async () => {
        const {storageRoot, database, jobs} = await createRepository();
        createQueuedJob(jobs, storageRoot);
        jobs.claimQueuedJob(new Date().toISOString());
        jobs.markReady(
            "internal-job-id",
            join(storageRoot, "jobs", "internal-job-id", "output", "book.zip"),
            null,
            "2026-07-11T12:00:00.000Z",
            "2026-07-11T14:00:00.000Z"
        );
        const validToken = createBrowserDownloadGrantToken();
        const usedToken = createBrowserDownloadGrantToken();
        const expiredToken = createBrowserDownloadGrantToken();
        for (const [token, expiresAt] of [
            [validToken, "2026-07-11T13:00:00.000Z"],
            [usedToken, "2026-07-11T13:00:00.000Z"],
            [expiredToken, "2026-07-11T12:01:00.000Z"]
        ] as const) {
            jobs.createBrowserDownloadGrant({
                publicJobId: "public-job-id",
                internalId: "internal-job-id",
                tokenHash: hashBrowserDownloadGrantToken(token),
                createdAt: "2026-07-11T12:00:00.000Z",
                expiresAt
            });
        }

        expect(
            jobs.consumeBrowserDownloadGrant(
                hashBrowserDownloadGrantToken(usedToken),
                "2026-07-11T12:02:00.000Z"
            )?.publicJobId
        ).toBe("public-job-id");
        jobs.purgeBrowserDownloadGrants("2026-07-11T12:10:00.000Z", "2026-07-11T12:05:00.000Z");

        let count = database
            .prepare("SELECT COUNT(*) AS count FROM browser_download_grants")
            .get() as {count: number};
        expect(count.count).toBe(1);
        expect(
            jobs.consumeBrowserDownloadGrant(
                hashBrowserDownloadGrantToken(validToken),
                "2026-07-11T12:10:00.000Z"
            )?.publicJobId
        ).toBe("public-job-id");

        jobs.markExpired("internal-job-id", "2026-07-11T12:11:00.000Z");
        jobs.purgeBrowserDownloadGrants("2026-07-11T12:11:00.000Z", "2026-07-11T12:11:00.000Z");
        jobs.purgeBrowserDownloadGrants("2026-07-11T12:11:00.000Z", "2026-07-11T12:11:00.000Z");
        count = database.prepare("SELECT COUNT(*) AS count FROM browser_download_grants").get() as {
            count: number;
        };
        expect(count.count).toBe(0);
    });

    it("atomically prevents storage reservations from oversubscribing available capacity", async () => {
        const {jobs} = await createRepository();
        const now = "2026-07-11T12:00:00.000Z";
        const expiresAt = "2026-07-11T14:00:00.000Z";

        expect(
            jobs.createStorageReservationIfCapacity(
                {ownerId: "first", reservedBytes: 80, createdAt: now, expiresAt},
                100
            )
        ).toBe(true);
        expect(
            jobs.createStorageReservationIfCapacity(
                {ownerId: "second", reservedBytes: 80, createdAt: now, expiresAt},
                100
            )
        ).toBe(false);

        jobs.releaseStorageReservation("first", "2026-07-11T12:01:00.000Z");
        expect(
            jobs.createStorageReservationIfCapacity(
                {ownerId: "second", reservedBytes: 80, createdAt: now, expiresAt},
                100
            )
        ).toBe(true);
    });

    it("recovers abandoned storage reservations after their expiry", async () => {
        const {storageRoot, jobs} = await createRepository();

        expect(
            jobs.createStorageReservationIfCapacity(
                {
                    ownerId: "abandoned",
                    reservedBytes: 80,
                    createdAt: "2026-07-11T12:00:00.000Z",
                    expiresAt: "2026-07-11T12:30:00.000Z"
                },
                100
            )
        ).toBe(true);

        await runCleanup(makeConfig(storageRoot), jobs);
        jobs.releaseExpiredStorageReservations("2026-07-11T12:31:00.000Z");
        expect(
            jobs.createStorageReservationIfCapacity(
                {
                    ownerId: "replacement",
                    reservedBytes: 80,
                    createdAt: "2026-07-11T12:31:00.000Z",
                    expiresAt: "2026-07-11T13:00:00.000Z"
                },
                100
            )
        ).toBe(true);
    });

    it("keeps expired-TTL reservations for live jobs", async () => {
        const {storageRoot, jobs} = await createRepository();
        createQueuedJob(jobs, storageRoot);
        expect(
            jobs.createStorageReservationIfCapacity(
                {
                    ownerId: "internal-job-id",
                    reservedBytes: 80,
                    createdAt: "2026-07-11T12:00:00.000Z",
                    expiresAt: "2026-07-11T12:30:00.000Z"
                },
                100
            )
        ).toBe(true);

        jobs.releaseExpiredStorageReservations("2026-07-11T12:31:00.000Z");

        expect(jobs.getActiveStorageReservation("internal-job-id")).toMatchObject({
            ownerId: "internal-job-id",
            reservedBytes: 80
        });
    });
});

describe("cleanup and archive safety", () => {
    it("prevents cleanup paths from escaping the storage root", async () => {
        const root = await makeStorageRoot();

        expect(() => ensurePathInside(root, join(root, "jobs", "safe"))).not.toThrow();
        expect(() => ensurePathInside(root, join(root, "..", "outside"))).toThrow();
        await expect(safeRemoveInside(root, join(root, "missing"))).resolves.toBeUndefined();
    });

    it("creates a non-empty ZIP without reading it into memory", async () => {
        const root = await makeStorageRoot();
        const chapters = join(root, "jobs", "job", "chapters");
        const output = join(root, "jobs", "job", "output");
        await mkdir(chapters, {recursive: true});
        await mkdir(output, {recursive: true});
        const chapterPath = join(chapters, "01 - Intro.mp3");
        await writeFile(chapterPath, "synthetic audio bytes");

        const zipPath = await createChapterZip(root, output, "book.zip", [chapterPath]);
        const zipStats = await stat(zipPath);

        expect(zipStats.size).toBeGreaterThan(0);
    });

    it("anonymizes failed jobs and removes orphan directories during cleanup", async () => {
        const {storageRoot, jobs} = await createRepository();
        createQueuedJob(jobs, storageRoot);
        jobs.claimQueuedJob(new Date().toISOString());
        jobs.markFailed(
            "internal-job-id",
            "PROCESSING_FAILED",
            "private diagnostic",
            new Date().toISOString()
        );
        const orphanDirectory = join(storageRoot, "jobs", "orphan-job");
        await mkdir(orphanDirectory, {recursive: true});
        await writeFile(join(orphanDirectory, "file.txt"), "orphan");

        await runCleanup({...makeConfig(storageRoot), orphanJobDirectoryMinAgeMinutes: 0}, jobs);

        const failed = jobs.findByInternalId("internal-job-id");
        expect(failed?.email).toBeNull();
        expect(failed?.displayFilename).toBe("audiobook");
        await expect(access(orphanDirectory)).rejects.toThrow();
    });

    it("does not delete an upload-promoted job directory while its reservation is active", async () => {
        const {storageRoot, jobs} = await createRepository();
        const reservedDirectory = join(storageRoot, "jobs", "reserved-internal-id");
        await mkdir(reservedDirectory, {recursive: true});
        await writeFile(join(reservedDirectory, "file.txt"), "upload");
        jobs.createStorageReservationIfCapacity(
            {
                ownerId: "reserved-internal-id",
                reservedBytes: 80,
                createdAt: "2026-07-11T12:00:00.000Z",
                expiresAt: new Date(Date.now() + 60_000).toISOString()
            },
            100
        );

        await runCleanup({...makeConfig(storageRoot), orphanJobDirectoryMinAgeMinutes: 0}, jobs);

        await expect(access(reservedDirectory)).resolves.toBeUndefined();
    });

    it("cleanup daemon exits promptly from an idle long interval after SIGTERM", async () => {
        const storageRoot = await makeStorageRoot();
        const tsxCli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
        const child = spawn(process.execPath, [tsxCli, "server/cleanup.ts"], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                NUXT_STORAGE_ROOT: storageRoot,
                NUXT_CLEANUP_INTERVAL_SECONDS: "3600"
            },
            stdio: "ignore",
            windowsHide: true
        });
        const heartbeatPath = join(storageRoot, "cleanup-heartbeat.json");

        for (let attempt = 0; attempt < 50; attempt += 1) {
            try {
                await access(heartbeatPath);
                break;
            } catch {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }
        await expect(access(heartbeatPath)).resolves.toBeUndefined();

        const exited = new Promise<number | null>((resolve) => {
            child.once("exit", (code) => resolve(code));
        });
        const startedAt = Date.now();
        child.kill("SIGTERM");
        const code = await Promise.race([
            exited,
            new Promise<"timeout">((resolve) => setTimeout(resolve, 4000, "timeout"))
        ]);

        if (code === "timeout") {
            child.kill("SIGKILL");
        }

        expect(code).not.toBe("timeout");
        expect(Date.now() - startedAt).toBeLessThan(4000);
    }, 10_000);
});

describe("mailgun delivery", () => {
    it("marks email sent and anonymizes address after success", async () => {
        const mocked = await import("mailgun.js");
        const create = Reflect.get(mocked, "__mailgunCreate") as ReturnType<typeof vi.fn>;
        create.mockResolvedValueOnce({});
        const {storageRoot, jobs} = await createRepository();
        createQueuedJob(jobs, storageRoot);
        jobs.claimQueuedJob(new Date().toISOString());
        jobs.markReady(
            "internal-job-id",
            join(storageRoot, "jobs", "internal-job-id", "output", "book.zip"),
            hashDownloadToken("token"),
            new Date().toISOString(),
            new Date(Date.now() + 3_600_000).toISOString()
        );
        const job = jobs.findByInternalId("internal-job-id");

        if (!job) {
            throw new Error("Expected ready job");
        }

        await deliverReadyEmail(makeConfig(storageRoot), jobs, job);

        const updated = jobs.findByInternalId("internal-job-id");
        expect(updated?.emailStatus).toBe("sent");
        expect(updated?.email).toBeNull();
    });

    it("retries Mailgun failures and preserves ready job status", async () => {
        const mocked = await import("mailgun.js");
        const create = Reflect.get(mocked, "__mailgunCreate") as ReturnType<typeof vi.fn>;
        create.mockRejectedValue(new Error("network down"));
        const {storageRoot, jobs} = await createRepository();
        createQueuedJob(jobs, storageRoot);
        jobs.claimQueuedJob(new Date().toISOString());
        jobs.markReady(
            "internal-job-id",
            join(storageRoot, "jobs", "internal-job-id", "output", "book.zip"),
            hashDownloadToken("token"),
            new Date().toISOString(),
            new Date(Date.now() + 3_600_000).toISOString()
        );
        const job = jobs.findByInternalId("internal-job-id");

        if (!job) {
            throw new Error("Expected ready job");
        }

        await deliverReadyEmail({...makeConfig(storageRoot), emailRetryAttempts: 2}, jobs, job);

        const updated = jobs.findByInternalId("internal-job-id");
        expect(updated?.status).toBe("ready");
        expect(updated?.emailStatus).toBe("pending");
        expect(updated?.emailAttempts).toBe(1);
        expect(updated?.emailNextAttemptAt).toEqual(expect.any(String));
    });

    it("rediscovers ready pending email after restart and sends it", async () => {
        const mocked = await import("mailgun.js");
        const create = Reflect.get(mocked, "__mailgunCreate") as ReturnType<typeof vi.fn>;
        create.mockResolvedValueOnce({});
        const {storageRoot, jobs} = await createRepository();
        createQueuedJob(jobs, storageRoot);
        jobs.claimQueuedJob(new Date().toISOString());
        jobs.markReady(
            "internal-job-id",
            join(storageRoot, "jobs", "internal-job-id", "output", "book.zip"),
            null,
            new Date().toISOString(),
            new Date(Date.now() + 60_000).toISOString()
        );

        await deliverDueEmails(makeConfig(storageRoot), jobs);

        expect(jobs.findByInternalId("internal-job-id")?.emailStatus).toBe("sent");
        expect(create).toHaveBeenCalledTimes(1);
    });

    it("sends the completion email only once when two deliveries race", async () => {
        const mocked = await import("mailgun.js");
        const create = Reflect.get(mocked, "__mailgunCreate") as ReturnType<typeof vi.fn>;
        create.mockResolvedValue({});
        const {storageRoot, jobs} = await createRepository();
        createQueuedJob(jobs, storageRoot);
        jobs.claimQueuedJob(new Date().toISOString());
        jobs.markReady(
            "internal-job-id",
            join(storageRoot, "jobs", "internal-job-id", "output", "book.zip"),
            null,
            new Date().toISOString(),
            new Date(Date.now() + 60_000).toISOString()
        );
        const job = jobs.findByInternalId("internal-job-id");

        if (!job) {
            throw new Error("Expected ready job");
        }

        await Promise.all([
            deliverReadyEmail(makeConfig(storageRoot), jobs, job),
            deliverReadyEmail(makeConfig(storageRoot), jobs, job)
        ]);

        expect(create).toHaveBeenCalledTimes(1);
        expect(jobs.findByInternalId("internal-job-id")?.emailStatus).toBe("sent");
    });

    it("does not send a completion email for a job at/near expiry", async () => {
        const mocked = await import("mailgun.js");
        const create = Reflect.get(mocked, "__mailgunCreate") as ReturnType<typeof vi.fn>;
        create.mockResolvedValue({});
        const {storageRoot, jobs} = await createRepository();
        createQueuedJob(jobs, storageRoot);
        jobs.claimQueuedJob(new Date().toISOString());
        jobs.markReady(
            "internal-job-id",
            join(storageRoot, "jobs", "internal-job-id", "output", "book.zip"),
            null,
            new Date().toISOString(),
            // Only a few seconds of life left — inside the pre-send safety buffer.
            new Date(Date.now() + 5_000).toISOString()
        );
        const job = jobs.findByInternalId("internal-job-id");

        if (!job) {
            throw new Error("Expected ready job");
        }

        await deliverReadyEmail(makeConfig(storageRoot), jobs, job);

        expect(create).not.toHaveBeenCalled();
        expect(jobs.findByInternalId("internal-job-id")?.emailStatus).toBe("failed");
    });

    it("does not record delivery when the job expires during the send", async () => {
        const mocked = await import("mailgun.js");
        const create = Reflect.get(mocked, "__mailgunCreate") as ReturnType<typeof vi.fn>;
        const {storageRoot, jobs} = await createRepository();
        createQueuedJob(jobs, storageRoot);
        jobs.claimQueuedJob(new Date().toISOString());
        jobs.markReady(
            "internal-job-id",
            join(storageRoot, "jobs", "internal-job-id", "output", "book.zip"),
            null,
            new Date().toISOString(),
            new Date(Date.now() + 3_600_000).toISOString()
        );
        const job = jobs.findByInternalId("internal-job-id");

        if (!job) {
            throw new Error("Expected ready job");
        }

        // Simulate cleanup expiring the job while the Mailgun request is in flight.
        create.mockImplementationOnce(async () => {
            jobs.markExpired("internal-job-id", new Date().toISOString());
            return {};
        });

        await deliverReadyEmail(makeConfig(storageRoot), jobs, job);

        // The email went out, but the job is expired — we must not report it as sent.
        expect(jobs.findByInternalId("internal-job-id")?.emailStatus).not.toBe("sent");
        expect(jobs.findByInternalId("internal-job-id")?.status).toBe("expired");
    });
});

interface FakeRequestEvent {
    __headers: Record<string, string>;
}

const makeIpEvent = (remoteAddress: string | undefined, headers: Record<string, string> = {}) =>
    ({
        node: {req: {socket: {remoteAddress}}},
        __headers: Object.fromEntries(
            Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])
        )
    }) as unknown as Parameters<typeof getClientIp>[0];

describe("client IP resolution and rate limiting", () => {
    const globalWithHeader = globalThis as {getHeader?: unknown};
    const originalGetHeader = globalWithHeader.getHeader;

    beforeAll(() => {
        globalWithHeader.getHeader = (event: unknown, name: string) =>
            (event as FakeRequestEvent).__headers?.[name.toLowerCase()];
    });

    afterAll(() => {
        globalWithHeader.getHeader = originalGetHeader;
    });

    it("ignores forwarded headers by default so identities cannot be spoofed", () => {
        const event = makeIpEvent("203.0.113.7", {"x-forwarded-for": "1.2.3.4"});

        expect(getClientIp(event, "")).toBe("203.0.113.7");
        expect(getClientIp(event, "false")).toBe("203.0.113.7");
    });

    it("does not trust X-Forwarded-For from a direct (untrusted) peer", () => {
        const event = makeIpEvent("198.51.100.9", {"x-forwarded-for": "10.0.0.1, 8.8.8.8"});

        expect(getClientIp(event, "127.0.0.1,::1")).toBe("198.51.100.9");
    });

    it("resolves the real client behind a trusted loopback proxy", () => {
        const event = makeIpEvent("127.0.0.1", {"x-forwarded-for": "203.0.113.20"});

        expect(getClientIp(event, "127.0.0.1")).toBe("203.0.113.20");
    });

    it("walks past chained trusted proxies to the first untrusted hop", () => {
        const event = makeIpEvent("10.0.0.2", {
            "x-forwarded-for": "5.5.5.5, 203.0.113.30, 10.0.0.1"
        });

        expect(getClientIp(event, "10.0.0.0/8")).toBe("203.0.113.30");
    });

    it("normalizes IPv4-mapped IPv6 peers against CIDR trust entries", () => {
        const event = makeIpEvent("::ffff:172.16.0.5", {"x-forwarded-for": "203.0.113.40"});

        expect(getClientIp(event, "172.16.0.0/12")).toBe("203.0.113.40");
    });

    it("trusts the immediate hop in single-proxy (true) mode", () => {
        const event = makeIpEvent("10.9.9.9", {"x-forwarded-for": "203.0.113.50"});

        expect(getClientIp(event, "true")).toBe("203.0.113.50");
    });

    it("matches IPv6 CIDR and exact trust entries across textual forms", () => {
        const cidrPeer = makeIpEvent("2001:db8:0:0:0:0:0:1", {"x-forwarded-for": "203.0.113.60"});
        expect(getClientIp(cidrPeer, "2001:db8::/32")).toBe("203.0.113.60");

        const exactPeer = makeIpEvent("2001:0db8::1", {"x-forwarded-for": "203.0.113.61"});
        expect(getClientIp(exactPeer, "2001:db8::1")).toBe("203.0.113.61");

        // A v4 peer must not match a v6 trust entry (family mismatch) → not trusted → socket peer.
        const v4Peer = makeIpEvent("198.51.100.10", {"x-forwarded-for": "203.0.113.62"});
        expect(getClientIp(v4Peer, "2001:db8::/32")).toBe("198.51.100.10");
    });

    it("enforces the per-key upload window and isolates distinct keys", () => {
        expect(checkUploadRateLimit("192.0.2.50", 2, 60_000)).toBe(true);
        expect(checkUploadRateLimit("192.0.2.50", 2, 60_000)).toBe(true);
        expect(checkUploadRateLimit("192.0.2.50", 2, 60_000)).toBe(false);
        expect(checkUploadRateLimit("192.0.2.51", 2, 60_000)).toBe(true);
    });
});

describe("worker shutdown and failure handling", () => {
    const claimJob = (storageRoot: string) => {
        const database = openDatabase(storageRoot);
        const jobs = createJobRepository(database);
        jobs.createJob({
            publicJobId: "shutdown-public-id",
            internalId: "shutdown-job",
            displayFilename: "Book.m4b",
            sourceFormat: "m4b",
            outputFormat: "m4b",
            fileSize: 100,
            email: "reader@example.test",
            sourcePath: join(storageRoot, "jobs", "shutdown-job", "source", "source.m4b"),
            createdAt: new Date().toISOString(),
            browserJobAccessTokenHash: hashBrowserJobAccessToken("browser-token")
        });
        const claimed = jobs.claimQueuedJob(new Date().toISOString());

        if (!claimed) {
            throw new Error("Expected queued job to be claimed");
        }

        return {jobs, claimed};
    };

    it("leaves an aborted job in processing state for recovery instead of failing it", async () => {
        const storageRoot = await makeStorageRoot();
        const {jobs, claimed} = claimJob(storageRoot);
        const controller = new AbortController();
        controller.abort();

        await processJob(makeConfig(storageRoot), jobs, claimed, {
            signal: controller.signal,
            inspectAudioFile: async () => {
                throw new Error("aborted mid-flight");
            }
        });

        const after = jobs.findByInternalId("shutdown-job");
        expect(after?.status).toBe("processing");
        expect(after?.publicErrorCode).toBeNull();
    });

    it("marks a job failed when processing errors without a shutdown abort", async () => {
        const storageRoot = await makeStorageRoot();
        const {jobs, claimed} = claimJob(storageRoot);

        await processJob(makeConfig(storageRoot), jobs, claimed, {
            inspectAudioFile: async () => {
                throw new PublicJobError("INVALID_AUDIO_FILE");
            }
        });

        const after = jobs.findByInternalId("shutdown-job");
        expect(after?.status).toBe("failed");
        expect(after?.publicErrorCode).toBe("INVALID_AUDIO_FILE");
    });
});

describe("production config validation", () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
    });

    it("is a no-op outside production even with unsafe values", () => {
        process.env.NODE_ENV = "development";

        expect(() =>
            validateProductionConfig({
                ...makeConfig("."),
                downloadSigningSecret: "",
                mailgunKey: "",
                siteUrl: "http://localhost:3000"
            })
        ).not.toThrow();
    });

    it("throws in production when required values are missing or unsafe", () => {
        process.env.NODE_ENV = "production";

        expect(() =>
            validateProductionConfig({
                ...makeConfig("."),
                downloadSigningSecret: "",
                siteUrl: "http://localhost:3000"
            })
        ).toThrow(/NUXT_DOWNLOAD_SIGNING_SECRET/);
    });

    it("passes in production when all required values are set", () => {
        process.env.NODE_ENV = "production";

        expect(() =>
            validateProductionConfig({
                ...makeConfig("."),
                siteUrl: "https://chaptify.example"
            })
        ).not.toThrow();
    });

    it("treats a localhost app origin as a warning, not a fatal error", () => {
        process.env.NODE_ENV = "production";

        // The API/cleanup processes (and containerized smoke tests) must still boot on localhost.
        expect(() =>
            validateProductionConfig({
                ...makeConfig("."),
                siteUrl: "http://localhost:3000"
            })
        ).not.toThrow();
    });

    it("requires Mailgun only when requireMailgun is set (worker)", () => {
        process.env.NODE_ENV = "production";
        const withoutMailgun = {
            ...makeConfig("."),
            siteUrl: "https://chaptify.example",
            mailgunKey: "",
            mailgunDomain: "",
            mailgunSender: "",
            mailgunBaseUrl: ""
        };

        // API/cleanup: Mailgun not required.
        expect(() => validateProductionConfig(withoutMailgun)).not.toThrow();
        // Worker: Mailgun required.
        expect(() => validateProductionConfig(withoutMailgun, {requireMailgun: true})).toThrow(
            /NUXT_MAILGUN_KEY/
        );
    });
});

describe("media input hardening", () => {
    it("rejects a disguised playlist upload without making an outbound request", async () => {
        const {createServer} = await import("node:http");
        let hits = 0;
        const server = createServer((_request, response) => {
            hits += 1;
            response.end("segment");
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;

        try {
            const root = await makeStorageRoot();
            // A crafted "audiobook" that is really an HLS playlist pointing at an external URL.
            const sourcePath = join(root, "source.mp3");
            await writeFile(
                sourcePath,
                `#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:10,\nhttp://127.0.0.1:${port}/segment.ts\n#EXT-X-ENDLIST\n`
            );

            // ffprobe/ffmpeg run with -protocol_whitelist file, so the crafted input is rejected as
            // invalid media and can never reach the external reference.
            await expect(inspectAudioFile(sourcePath, "mp3")).rejects.toThrow(PublicJobError);
            expect(hits).toBe(0);
        } finally {
            await new Promise<void>((resolve) => {
                server.close(() => resolve());
            });
        }
    });
});

describe("contact form", () => {
    it("accepts a valid submission and trims free-text fields", () => {
        const parsed = contactRequestSchema.parse({
            name: "  Adrian  ",
            email: "runner@example.test",
            topic: "feature",
            message: "  The waveform looks great, but M4B chapters with umlauts fail.  "
        });

        expect(parsed.name).toBe("Adrian");
        expect(parsed.message).toBe(
            "The waveform looks great, but M4B chapters with umlauts fail."
        );
    });

    it("rejects invalid submissions", () => {
        const base = {
            name: "Adrian",
            email: "runner@example.test",
            topic: "bug",
            message: "Something broke while splitting my audiobook."
        };

        expect(contactRequestSchema.safeParse({...base, email: "not-an-email"}).success).toBe(
            false
        );
        expect(contactRequestSchema.safeParse({...base, topic: undefined}).success).toBe(false);
        expect(contactRequestSchema.safeParse({...base, topic: "spam"}).success).toBe(false);
        expect(contactRequestSchema.safeParse({...base, topic: ["bug"]}).success).toBe(false);
        expect(contactRequestSchema.safeParse({...base, message: "short"}).success).toBe(false);
        expect(contactRequestSchema.safeParse({...base, name: ""}).success).toBe(false);
    });

    it("sends a text-only contact email to the operator with Reply-To", async () => {
        const mocked = await import("mailgun.js");
        const create = Reflect.get(mocked, "__mailgunCreate") as ReturnType<typeof vi.fn>;
        create.mockClear();
        create.mockResolvedValueOnce({});
        const service = createMailgunService(makeConfig("unused-storage-root"));

        await service.sendContactEmail({
            name: "Adrian",
            replyTo: "runner@example.test",
            topic: "feature",
            message: "Please add chapter renaming."
        });

        expect(create).toHaveBeenCalledTimes(1);
        const [domain, payload] = create.mock.calls[0] as [string, Record<string, unknown>];
        expect(domain).toBe("example.test");
        expect(payload.to).toBe("operator@example.test");
        expect(payload["h:Reply-To"]).toBe("runner@example.test");
        expect(payload.subject).toBe("Chaptify contact: Feature suggestion");
        expect(payload.text).toContain("Please add chapter renaming.");
        expect(payload.html).toBeUndefined();
    });

    it("fails without exposing details when the contact recipient is not configured", async () => {
        const service = createMailgunService({
            ...makeConfig("unused-storage-root"),
            contactRecipient: ""
        });

        await expect(
            service.sendContactEmail({
                name: "Adrian",
                replyTo: "runner@example.test",
                topic: "bug",
                message: "Something broke while splitting my audiobook."
            })
        ).rejects.toThrow("Contact recipient is not configured");
    });
});
