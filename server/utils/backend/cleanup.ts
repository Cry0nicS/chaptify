import type {BackendConfig} from "./config";
import type {JobRepository} from "./database";
import {readdir, stat} from "node:fs/promises";
import {join} from "node:path";
import {ensurePathInside, safeRemoveInside} from "./paths";
import {cleanupJobFiles} from "./storage";

const ABANDONED_UPLOAD_AGE_MS = 60 * 60 * 1000;

const cleanupAbandonedUploads = async (storageRoot: string, nowMs: number) => {
    const uploadsDirectory = ensurePathInside(storageRoot, join(storageRoot, "uploads"));
    let entries: string[];

    try {
        entries = await readdir(uploadsDirectory);
    } catch {
        return;
    }

    for (const entry of entries) {
        const path = ensurePathInside(storageRoot, join(uploadsDirectory, entry));

        try {
            const stats = await stat(path);
            if (nowMs - stats.mtimeMs >= ABANDONED_UPLOAD_AGE_MS) {
                await safeRemoveInside(storageRoot, path);
            }
        } catch (error) {
            console.warn("Cleanup failed for an abandoned upload", {
                error: String(error)
            });
        }
    }
};

const cleanupOrphanJobDirectories = async (
    storageRoot: string,
    jobs: JobRepository,
    nowMs: number,
    minimumAgeMs: number
) => {
    const jobsDirectory = ensurePathInside(storageRoot, join(storageRoot, "jobs"));
    const knownIds = new Set(jobs.listKnownInternalIds());
    let entries: string[];

    try {
        entries = await readdir(jobsDirectory);
    } catch {
        return;
    }

    for (const entry of entries) {
        if (knownIds.has(entry)) {
            continue;
        }

        if (jobs.hasActiveStorageReservation(entry)) {
            continue;
        }

        try {
            const path = ensurePathInside(storageRoot, join(jobsDirectory, entry));
            const stats = await stat(path);
            if (minimumAgeMs > 0 && nowMs - stats.mtimeMs < minimumAgeMs) {
                continue;
            }

            await safeRemoveInside(storageRoot, path);
        } catch (error) {
            console.warn("Cleanup failed for an orphan job directory", {
                error: String(error)
            });
        }
    }
};

/**
 * Removes expired ready output and failed-job leftovers from shared storage.
 *
 * Expired ready jobs lose their ZIP, job directory, and token hashes. Failed jobs keep their public
 * status row but lose temporary files. Each removal is best-effort so one bad directory does not
 * stop the worker from cleaning other jobs.
 */
const normalizeCleanupConfig = (
    config: BackendConfig | string
): Pick<
    BackendConfig,
    "storageRoot" | "orphanJobDirectoryMinAgeMinutes" | "browserDownloadGrantUsedGraceSeconds"
> =>
    typeof config === "string"
        ? {
              storageRoot: config,
              orphanJobDirectoryMinAgeMinutes: 30,
              browserDownloadGrantUsedGraceSeconds: 300
          }
        : config;

export const runCleanup = async (
    config: BackendConfig | string,
    jobs: JobRepository
): Promise<void> => {
    const cleanupConfig = normalizeCleanupConfig(config);
    const {storageRoot} = cleanupConfig;
    const now = new Date().toISOString();
    const nowMs = Date.now();
    const grantUsedBefore = new Date(
        nowMs - cleanupConfig.browserDownloadGrantUsedGraceSeconds * 1000
    ).toISOString();
    jobs.expirePendingEmails(now);
    jobs.releaseExpiredStorageReservations(now);
    jobs.purgeBrowserDownloadGrants(now, grantUsedBefore);
    const expiredJobs = jobs.listExpiredReadyJobs(now);

    for (const job of expiredJobs) {
        try {
            if (job.outputPath) {
                await safeRemoveInside(storageRoot, job.outputPath);
            }

            await cleanupJobFiles(storageRoot, job.internalId);
            if (jobs.markExpired(job.internalId, now)) {
                jobs.releaseStorageReservation(job.internalId, now);
                jobs.purgeBrowserDownloadGrants(now, grantUsedBefore);
            }
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
            jobs.releaseStorageReservation(job.internalId, now);
            jobs.anonymizeFailedJob(job.internalId);
        } catch (error) {
            console.warn("Cleanup failed for a failed job", {
                jobId: job.publicJobId,
                error: String(error)
            });
        }
    }

    await cleanupAbandonedUploads(storageRoot, nowMs);
    await cleanupOrphanJobDirectories(
        storageRoot,
        jobs,
        nowMs,
        cleanupConfig.orphanJobDirectoryMinAgeMinutes * 60 * 1000
    );
};
