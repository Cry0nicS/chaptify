import {access, mkdir, readFile, stat, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {describe, expect, it, vi} from "vitest";
import {createJobRepository, openDatabase} from "../../server/utils/backend/database";
import {hashBrowserJobAccessToken} from "../../server/utils/backend/ids";
import {probeForConversion} from "../../server/utils/backend/media";
import {processJob} from "../../server/utils/backend/worker";
import {
    createChapterlessAudio,
    createRepository,
    createSyntheticAudiobook,
    makeConfig,
    makeStorageRoot,
    probeMedia,
    registerBackendTestHooks
} from "./helpers";

vi.mock("mailgun.js", async () => (await import("./mailgun-mock")).mailgunModuleMock());

registerBackendTestHooks();

describe("audio conversion end-to-end", () => {
    it.each([
        // input format, target format, expected codec after re-encode
        ["m4b", "mp3", "mp3"],
        ["mp3", "m4b", "aac"]
    ] as const)(
        "converts a generated %s to %s as a single file, preserving chapters and metadata",
        async (inputFormat, targetFormat, expectedCodec) => {
            const storageRoot = await makeStorageRoot();
            const database = openDatabase(storageRoot);
            const jobs = createJobRepository(database);
            const internalId = `${inputFormat}-to-${targetFormat}-job`;
            const sourceDirectory = join(storageRoot, "jobs", internalId, "source");
            await mkdir(sourceDirectory, {recursive: true});
            const sourcePath = join(sourceDirectory, `source.${inputFormat}`);
            const generatedPath = await createSyntheticAudiobook(storageRoot, inputFormat);
            await writeFile(sourcePath, await readFile(generatedPath));

            jobs.createJob({
                publicJobId: `${internalId}-public`,
                internalId,
                kind: "convert",
                displayFilename: `Synthetic.${inputFormat}`,
                sourceFormat: inputFormat,
                outputFormat: targetFormat,
                fileSize: (await stat(sourcePath)).size,
                email: "reader@example.test",
                sourcePath,
                createdAt: new Date().toISOString(),
                browserJobAccessTokenHash: hashBrowserJobAccessToken("browser-token"),
                splitWithoutChapters: false
            });

            const claimed = jobs.claimQueuedJob(new Date().toISOString());
            if (!claimed) {
                throw new Error("Expected queued convert job to be claimed");
            }

            await processJob(makeConfig(storageRoot), jobs, claimed);

            const ready = jobs.findByInternalId(internalId);
            expect(ready?.status).toBe("ready");
            expect(ready?.outputPath).toEqual(expect.any(String));
            if (!ready?.outputPath) {
                throw new Error("Expected a converted output file");
            }

            // A single converted file named with the target extension — not a ZIP.
            expect(ready.outputPath.endsWith(`.${targetFormat}`)).toBe(true);
            await expect(access(ready.outputPath)).resolves.toBeUndefined();
            // Source is cleaned up after a successful conversion.
            await expect(access(sourcePath)).rejects.toThrow();

            const probed = await probeMedia(ready.outputPath);
            const audioStreams = probed.streams.filter((stream) => stream.codec_type === "audio");
            expect(audioStreams).toHaveLength(1);
            expect(audioStreams[0]?.codec_name).toBe(expectedCodec);
            // Faithful repackage: the source's chapters and title survive the conversion.
            expect((probed.chapters || []).length).toBe(2);
            expect(String((probed.format.tags || {}).title)).toBe("Synthetic Book");

            const history = jobs
                .listUploadHistory()
                .find((entry) => entry.publicJobId === `${internalId}-public`);
            expect(history?.status).toBe("ready");
            expect(history?.chapterCount).toBe(2);
        }
    );

    it.each(["split", "convert"] as const)(
        "persists the %s kind through createJobIfCapacity (the endpoint path)",
        async (kind) => {
            const {jobs, storageRoot} = await createRepository();

            const created = jobs.createJobIfCapacity(
                {
                    publicJobId: `${kind}-cap-public`,
                    internalId: `${kind}-cap`,
                    kind,
                    displayFilename: "song.mp3",
                    sourceFormat: "mp3",
                    outputFormat: "m4b",
                    fileSize: 100,
                    email: "reader@example.test",
                    sourcePath: join(storageRoot, "jobs", `${kind}-cap`, "source", "source.mp3"),
                    createdAt: new Date().toISOString(),
                    browserJobAccessTokenHash: hashBrowserJobAccessToken("browser-token"),
                    splitWithoutChapters: false
                },
                10
            );

            expect(created).toBe(true);
            expect(jobs.findByInternalId(`${kind}-cap`)?.kind).toBe(kind);
        }
    );

    it("probes a chapterless file without requiring chapters", async () => {
        const root = await makeStorageRoot();
        const sourcePath = await createChapterlessAudio(root, "mp3", 5);

        const probe = await probeForConversion(sourcePath);

        expect(probe.audioCodec).toBe("mp3");
        expect(probe.chapterCount).toBe(0);
        expect(probe.duration).toBeGreaterThan(4);
        expect(probe.hasCoverArt).toBe(false);
    });
});
