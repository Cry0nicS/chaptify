import {access, mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {describe, expect, it, vi} from "vitest";
import {createChapterZip} from "../../server/utils/backend/archive";
import {runCleanup} from "../../server/utils/backend/cleanup";

import {
    createBrowserDownloadGrantToken,
    createBrowserJobAccessToken,
    createDownloadToken,
    createSignedDownloadToken,
    hashBrowserDownloadGrantToken,
    hashBrowserJobAccessToken,
    hashDownloadToken,
    verifySignedDownloadToken
} from "../../server/utils/backend/ids";

import {processJob, recoverInterruptedJobs} from "../../server/utils/backend/worker";
import {createQueuedJob, createRepository, makeConfig, registerBackendTestHooks} from "./helpers";

vi.mock("mailgun.js", async () => (await import("./mailgun-mock")).mailgunModuleMock());

registerBackendTestHooks();

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
                bookTitle: null,
                author: null,
                segmented: false
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
                bookTitle: null,
                author: null,
                segmented: false
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
                bookTitle: null,
                author: null,
                segmented: false
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
                    bookTitle: null,
                    author: null,
                    segmented: false
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
