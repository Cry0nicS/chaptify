import {join} from "node:path";
import {describe, expect, it, vi} from "vitest";

import {hashDownloadToken} from "../../server/utils/backend/ids";

import {deliverReadyEmail} from "../../server/utils/backend/worker";
import {createQueuedJob, createRepository, makeConfig, registerBackendTestHooks} from "./helpers";

vi.mock("mailgun.js", async () => (await import("./mailgun-mock")).mailgunModuleMock());

registerBackendTestHooks();

describe("upload history", () => {
    it("creates a history row on upload with NULL metadata until the probe runs", async () => {
        const {storageRoot, jobs} = await createRepository();
        createQueuedJob(jobs, storageRoot);

        const history = jobs
            .listUploadHistory()
            .find((entry) => entry.publicJobId === "public-job-id");
        expect(history).toMatchObject({
            bookTitle: "Book",
            sourceFormat: "m4b",
            outputFormat: "m4b",
            fileSizeBytes: 100,
            email: "reader@example.test",
            status: "queued",
            emailStatus: "pending"
        });
        expect(history?.durationSeconds).toBeNull();
        expect(history?.chapterCount).toBeNull();
        expect(history?.author).toBeNull();
        expect(history?.embeddedTitle).toBeNull();
        expect(history?.errorCode).toBeNull();
        expect(history?.completedAt).toBeNull();
    });

    it("enriches the history row with probed metadata", async () => {
        const {storageRoot, jobs} = await createRepository();
        createQueuedJob(jobs, storageRoot);

        jobs.recordHistoryInspection("public-job-id", {
            durationSeconds: 5400.5,
            chapterCount: 12,
            author: "Jane Narrator",
            embeddedTitle: "The Long Run",
            segmented: false
        });

        const history = jobs
            .listUploadHistory()
            .find((entry) => entry.publicJobId === "public-job-id");
        expect(history?.durationSeconds).toBe(5400.5);
        expect(history?.chapterCount).toBe(12);
        expect(history?.segmented).toBe(false);
        expect(history?.author).toBe("Jane Narrator");
        expect(history?.embeddedTitle).toBe("The Long Run");
    });

    it("records failures with their public error code", async () => {
        const {storageRoot, jobs} = await createRepository();
        createQueuedJob(jobs, storageRoot);
        jobs.claimQueuedJob(new Date().toISOString());
        jobs.markFailed(
            "internal-job-id",
            "NO_CHAPTERS_FOUND",
            "diagnostic",
            new Date().toISOString()
        );

        const history = jobs
            .listUploadHistory()
            .find((entry) => entry.publicJobId === "public-job-id");
        expect(history?.status).toBe("failed");
        expect(history?.errorCode).toBe("NO_CHAPTERS_FOUND");
        expect(history?.completedAt).toEqual(expect.any(String));
        expect(history?.email).toBe("reader@example.test");
    });

    it("keeps the recipient email in history after the job record is anonymized", async () => {
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

        expect(jobs.findByInternalId("internal-job-id")?.email).toBeNull();
        const history = jobs
            .listUploadHistory()
            .find((entry) => entry.publicJobId === "public-job-id");
        expect(history?.status).toBe("ready");
        expect(history?.emailStatus).toBe("sent");
        expect(history?.email).toBe("reader@example.test");
    });
});
