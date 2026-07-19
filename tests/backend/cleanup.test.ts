import {spawn} from "node:child_process";
import {access, mkdir, stat, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {describe, expect, it, vi} from "vitest";
import {createChapterZip} from "../../server/utils/backend/archive";
import {runCleanup} from "../../server/utils/backend/cleanup";

import {ensurePathInside, safeRemoveInside} from "../../server/utils/backend/paths";

import {
    createQueuedJob,
    createRepository,
    makeConfig,
    makeStorageRoot,
    registerBackendTestHooks
} from "./helpers";

vi.mock("mailgun.js", async () => (await import("./mailgun-mock")).mailgunModuleMock());

registerBackendTestHooks();

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
