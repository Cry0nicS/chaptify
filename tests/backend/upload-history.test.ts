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

    it("scrubs the recipient email from history once the job record is scrubbed", async () => {
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
        // The address is gone within seconds of delivery, not at link expiry: the link is already in
        // the recipient's inbox, so the address has no remaining purpose.
        expect(history?.email).toBeNull();
        // Everything analytics needs survives.
        expect(history).toMatchObject({
            bookTitle: "Book",
            sourceFormat: "m4b",
            outputFormat: "m4b",
            fileSizeBytes: 100
        });
        expect(history?.uploadedAt).toEqual(expect.any(String));
    });

    it("scrubs the recipient email from history when a failed job is anonymized", async () => {
        const {storageRoot, jobs} = await createRepository();
        createQueuedJob(jobs, storageRoot);
        jobs.claimQueuedJob(new Date().toISOString());
        jobs.markFailed(
            "internal-job-id",
            "NO_CHAPTERS_FOUND",
            "diagnostic",
            new Date().toISOString()
        );
        // Cleanup anonymizes failed jobs; it is the one email-nulling path that does not otherwise
        // sync history, so it is asserted separately rather than assumed to be covered.
        jobs.anonymizeFailedJob("internal-job-id");

        expect(jobs.findByInternalId("internal-job-id")?.email).toBeNull();
        const history = jobs
            .listUploadHistory()
            .find((entry) => entry.publicJobId === "public-job-id");
        expect(history?.email).toBeNull();
        expect(history?.status).toBe("failed");
        expect(history?.errorCode).toBe("NO_CHAPTERS_FOUND");
    });

    it("scrubs the recipient email from history when email delivery permanently fails", async () => {
        const {storageRoot, jobs} = await createRepository();
        createQueuedJob(jobs, storageRoot);
        jobs.claimQueuedJob(new Date().toISOString());
        jobs.markEmailFailed("internal-job-id", "permanent failure");

        expect(jobs.findByInternalId("internal-job-id")?.email).toBeNull();
        const history = jobs
            .listUploadHistory()
            .find((entry) => entry.publicJobId === "public-job-id");
        // A give-up on delivery is still a point where the address stops being useful, so it is
        // scrubbed even though nothing was ever delivered.
        expect(history?.email).toBeNull();
        expect(history?.emailStatus).toBe("failed");
    });

    it("scrubs the recipient email from history when a pending email expires", async () => {
        const {storageRoot, jobs} = await createRepository();
        createQueuedJob(jobs, storageRoot);
        jobs.claimQueuedJob(new Date().toISOString());
        const past = new Date(Date.now() - 3_600_000).toISOString();
        jobs.markReady(
            "internal-job-id",
            join(storageRoot, "jobs", "internal-job-id", "output", "book.zip"),
            hashDownloadToken("token"),
            past,
            past
        );

        // The bulk path: one statement over every matching job, so the history sweep has to work
        // set-wise rather than for a single known id.
        jobs.expirePendingEmails(new Date().toISOString());

        expect(jobs.findByInternalId("internal-job-id")?.email).toBeNull();
        const history = jobs
            .listUploadHistory()
            .find((entry) => entry.publicJobId === "public-job-id");
        expect(history?.email).toBeNull();
    });

    it("scrubs a pre-existing row whose job was already scrubbed, with no migration step", async () => {
        const {storageRoot, jobs, database} = await createRepository();
        createQueuedJob(jobs, storageRoot);

        // Reproduce the old world this change reverses: the operational row has been scrubbed, but the
        // history row still holds the address because retaining it used to be deliberate.
        database
            .prepare("UPDATE jobs SET email = NULL WHERE internal_id = ?")
            .run("internal-job-id");
        expect(
            jobs.listUploadHistory().find((entry) => entry.publicJobId === "public-job-id")?.email
        ).toBe("reader@example.test");

        // Any ordinary transition triggers the sweep. This is what makes the change self-backfilling:
        // rows written before it existed need no separate migration or hand-run script.
        jobs.markExpired("internal-job-id", new Date().toISOString());

        const history = jobs
            .listUploadHistory()
            .find((entry) => entry.publicJobId === "public-job-id");
        expect(history?.email).toBeNull();
        expect(history?.bookTitle).toBe("Book");
    });

    it("leaves no history row holding an address whose job has been scrubbed", async () => {
        const {storageRoot, jobs, database} = await createRepository();
        createQueuedJob(jobs, storageRoot);
        jobs.claimQueuedJob(new Date().toISOString());
        jobs.markExpired("internal-job-id", new Date().toISOString());

        // The invariant, asserted over the whole table rather than one row: this is the property the
        // design turns on, and it is what a future email-nulling path would have to keep true.
        const violations = database
            .prepare(
                `
                SELECT h.public_job_id FROM upload_history h
                JOIN jobs j ON j.public_job_id = h.public_job_id
                WHERE j.email IS NULL AND h.email IS NOT NULL
            `
            )
            .all();
        expect(violations).toEqual([]);
    });
});
