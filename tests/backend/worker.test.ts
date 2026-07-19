import {join} from "node:path";
import {describe, expect, it, vi} from "vitest";

import {createJobRepository, openDatabase} from "../../server/utils/backend/database";
import {PublicJobError} from "../../server/utils/backend/errors";
import {hashBrowserJobAccessToken} from "../../server/utils/backend/ids";

import {processJob} from "../../server/utils/backend/worker";
import {makeConfig, makeStorageRoot, registerBackendTestHooks} from "./helpers";

vi.mock("mailgun.js", async () => (await import("./mailgun-mock")).mailgunModuleMock());

registerBackendTestHooks();

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
