import {access, mkdir, readFile, stat, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {describe, expect, it, vi} from "vitest";
import {runCleanup} from "../../server/utils/backend/cleanup";

import {createJobRepository, openDatabase} from "../../server/utils/backend/database";
import {PublicJobError} from "../../server/utils/backend/errors";
import {
    createSignedDownloadToken,
    hashBrowserJobAccessToken,
    verifySignedDownloadToken
} from "../../server/utils/backend/ids";
import {inspectAudioFile, splitChapters} from "../../server/utils/backend/media";

import {processJob} from "../../server/utils/backend/worker";
import {
    createSyntheticAudiobook,
    listZipEntries,
    makeConfig,
    makeStorageRoot,
    probeMedia,
    registerBackendTestHooks
} from "./helpers";

vi.mock("mailgun.js", async () => (await import("./mailgun-mock")).mailgunModuleMock());

registerBackendTestHooks();

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

            const history = jobs
                .listUploadHistory()
                .find((entry) => entry.publicJobId === `${inputFormat}-public-job-id`);
            expect(history?.bookTitle).toBe("Synthetic");
            expect(history?.embeddedTitle).toBe("Synthetic Book");
            expect(history?.author).toBe("Synthetic Author");
            expect(history?.chapterCount).toBe(2);
            expect(history?.durationSeconds).toBeGreaterThan(3);
            expect(history?.status).toBe("ready");
            expect(history?.email).toBe("reader@example.test");

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

            const expiredHistory = jobs
                .listUploadHistory()
                .find((entry) => entry.publicJobId === `${inputFormat}-public-job-id`);
            expect(expiredHistory?.status).toBe("expired");
            expect(expiredHistory?.email).toBe("reader@example.test");
        }
    );
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
