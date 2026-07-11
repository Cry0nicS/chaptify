import type {JobRepository} from "./database";
import {safeRemoveInside} from "./paths";
import {cleanupJobFiles} from "./storage";

export const runCleanup = async (storageRoot: string, jobs: JobRepository): Promise<void> => {
    const now = new Date().toISOString();
    const expiredJobs = jobs.listExpiredReadyJobs(now);

    for (const job of expiredJobs) {
        try {
            if (job.zipPath) {
                await safeRemoveInside(storageRoot, job.zipPath);
            }

            await cleanupJobFiles(storageRoot, job.internalId);
            jobs.markExpired(job.internalId, now);
        } catch (error) {
            console.warn("Cleanup failed for an expired job", {
                jobId: job.publicJobId,
                error: String(error)
            });
        }
    }

    for (const job of jobs.listFailedJobsWithFiles()) {
        try {
            await cleanupJobFiles(storageRoot, job.internalId);
        } catch (error) {
            console.warn("Cleanup failed for a failed job", {
                jobId: job.publicJobId,
                error: String(error)
            });
        }
    }
};
