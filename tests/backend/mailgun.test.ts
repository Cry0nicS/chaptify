import {join} from "node:path";
import {describe, expect, it, vi} from "vitest";

import {hashDownloadToken} from "../../server/utils/backend/ids";

import {deliverDueEmails, deliverReadyEmail} from "../../server/utils/backend/worker";
import {createQueuedJob, createRepository, makeConfig, registerBackendTestHooks} from "./helpers";

vi.mock("mailgun.js", async () => (await import("./mailgun-mock")).mailgunModuleMock());

registerBackendTestHooks();

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
