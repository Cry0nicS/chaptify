import type {JobRepository} from "./database";
import {safeRemoveInside} from "./paths";
import {cleanupJobFiles} from "./storage";

/**
 * Removes expired ready output and failed-job leftovers from shared storage.
 *
 * Expired ready jobs lose their ZIP, job directory, and token hashes. Failed jobs keep their public
 * status row but lose temporary files. Each removal is best-effort so one bad directory does not
 * stop the worker from cleaning other jobs.
 */
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
