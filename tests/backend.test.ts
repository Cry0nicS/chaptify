import type {BackendConfig} from "../server/utils/backend/config";
import {access, mkdir, mkdtemp, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {createChapterZip} from "../server/utils/backend/archive";
import {ensureStorageRoot, getBackendConfigFromEnv} from "../server/utils/backend/config";
import {
    createJobRepository,
    openDatabase,
    resetDatabaseForTests
} from "../server/utils/backend/database";
import {loadDotenv, parseDotenv} from "../server/utils/backend/env";
import {PublicJobError, serializePublicError} from "../server/utils/backend/errors";
import {
    createBrowserJobAccessToken,
    createDownloadToken,
    hashBrowserJobAccessToken,
    hashDownloadToken
} from "../server/utils/backend/ids";
import {validateChapters} from "../server/utils/backend/media";
import {
    buildChapterFilenames,
    ensurePathInside,
    safeRemoveInside,
    sanitizeChapterTitle,
    sanitizeDisplayFilename
} from "../server/utils/backend/paths";
import {deliverReadyEmail, recoverInterruptedJobs} from "../server/utils/backend/worker";
import {DEFAULT_JOB_RETENTION_HOURS} from "../shared/utils/constants";
import {uploadMetadataSchema} from "../shared/utils/schemas";

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
    appBaseUrl: "http://localhost:3000",
    storageRoot,
    maxUploadBytes: 1024,
    maxQueuedJobs: 10,
    workerConcurrency: 1,
    jobRetentionHours: DEFAULT_JOB_RETENTION_HOURS,
    emailRetryAttempts: 3,
    mailgunBaseUrl: "https://api.mailgun.test",
    mailgunDomain: "example.test",
    mailgunKey: "key-test",
    mailgunSender: "sender@example.test",
    mailgunRecipient: "",
    mailgunBcc: ""
});

const createRepository = async () => {
    const storageRoot = await makeStorageRoot();
    const database = openDatabase(storageRoot);
    const jobs = createJobRepository(database);

    return {storageRoot, jobs};
};

const createQueuedJob = (jobs: ReturnType<typeof createJobRepository>, storageRoot: string) => {
    jobs.createJob({
        publicJobId: "public-job-id",
        internalId: "internal-job-id",
        displayFilename: "Book.m4b",
        sourceFormat: "m4b",
        fileSize: 100,
        email: "reader@example.test",
        sourcePath: join(storageRoot, "jobs", "internal-job-id", "source", "source.m4b"),
        createdAt: new Date().toISOString(),
        browserJobAccessTokenHash: hashBrowserJobAccessToken("browser-token")
    });
};

afterEach(() => {
    resetDatabaseForTests();
    vi.clearAllMocks();
});

describe("public validation and filenames", () => {
    it("validates submitted email and upload metadata", () => {
        expect(
            uploadMetadataSchema.parse({
                email: "reader@example.test",
                fileName: "book.mp3",
                fileSize: 1,
                extension: "mp3"
            })
        ).toMatchObject({extension: "mp3"});
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
        expect(buildChapterFilenames(["Intro", "Intro", ""], "m4a")).toEqual([
            "01 - Intro.m4a",
            "02 - Intro (2).m4a",
            "03 - Chapter 03.m4a"
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
                "NUXT_APP_BASE_URL=https://example.test",
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

        expect(env.CHAPTIFY_APP_BASE_URL).toBe("https://example.test");
        expect(env.NUXT_APP_BASE_URL).toBeUndefined();
        expect(env.NUXT_MAILGUN_KEY).toBe("key-from-shell");
        expect(env.NUXT_MAILGUN_DOMAIN).toBe("mg.example.test");
    });

    it("keeps getBackendConfigFromEnv aligned with loaded Mailgun config", async () => {
        const root = await mkdtemp(join(tmpdir(), "chaptify-env-"));
        await writeFile(
            join(root, ".env"),
            [
                "NUXT_APP_BASE_URL=https://example.test",
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
                appBaseUrl: "https://example.test",
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
        const chapterPath = join(chaptersDirectory, "partial.m4a");
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
            new Date(Date.now() + 1000).toISOString()
        );
        const job = jobs.findByInternalId("internal-job-id");

        if (!job) {
            throw new Error("Expected ready job");
        }

        await deliverReadyEmail(makeConfig(storageRoot), jobs, job, "token");

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
            new Date(Date.now() + 1000).toISOString()
        );
        const job = jobs.findByInternalId("internal-job-id");

        if (!job) {
            throw new Error("Expected ready job");
        }

        await deliverReadyEmail(
            {...makeConfig(storageRoot), emailRetryAttempts: 2},
            jobs,
            job,
            "token"
        );

        const updated = jobs.findByInternalId("internal-job-id");
        expect(updated?.status).toBe("ready");
        expect(updated?.emailStatus).toBe("failed");
        expect(updated?.emailAttempts).toBe(2);
    });
});
