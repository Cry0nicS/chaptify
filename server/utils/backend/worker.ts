import type {BackendConfig} from "./config";
import type {JobRecord, JobRepository} from "./database";
import {access, mkdir, rm} from "node:fs/promises";
import {basename, join} from "node:path";
import {createChapterZip} from "./archive";
import {runCleanup} from "./cleanup";
import {normalizeBaseUrl} from "./config";
import {PublicJobError} from "./errors";
import {createSignedDownloadToken} from "./ids";
import {createMailgunService} from "./mailgun";
import {inspectAudioFile, splitChapters} from "./media";
import {ensurePathInside, jobDirectory} from "./paths";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const deliverReadyEmail = async (
    config: BackendConfig,
    jobs: JobRepository,
    job: JobRecord
): Promise<void> => {
    if (!config.downloadSigningSecret) {
        jobs.markEmailFailed(job.internalId, "missing_signing_secret");
        return;
    }

    const mailgun = createMailgunService(config);
    const token = createSignedDownloadToken({
        publicJobId: job.publicJobId,
        internalId: job.internalId,
        expiresAt: job.expiresAt || "",
        signingSecret: config.downloadSigningSecret
    });
    const downloadUrl = `${normalizeBaseUrl(config.appBaseUrl || "http://localhost:3000")}/api/download/${token}`;

    if (!job.email || !job.expiresAt || job.emailAttempts >= config.emailRetryAttempts) {
        jobs.markEmailFailed(job.internalId, "retry_limit_reached");
        return;
    }

    if (new Date(job.expiresAt).getTime() <= Date.now()) {
        jobs.markEmailFailed(job.internalId, "expired");
        return;
    }

    try {
        await mailgun.sendCompletionEmail({
            to: job.email,
            downloadUrl,
            expiresInHours: config.jobRetentionHours
        });
        jobs.markEmailSent(job.internalId, new Date().toISOString());
    } catch (error) {
        const attempt = job.emailAttempts + 1;
        const retryLimitReached = attempt >= config.emailRetryAttempts;
        const baseDelayMs = config.emailRetryBaseDelaySeconds * 1000;
        const maxDelayMs = config.emailRetryMaxDelaySeconds * 1000;
        const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
        const jitter = Math.floor(Math.random() * Math.min(baseDelayMs, exponentialDelay));
        const nextAttemptAt = retryLimitReached
            ? null
            : new Date(Date.now() + exponentialDelay + jitter).toISOString();
        const safeFailure = String(error).slice(0, 160);

        jobs.recordEmailAttempt(job.internalId, nextAttemptAt, safeFailure);
        console.warn("Completion email attempt failed", {
            jobId: job.publicJobId,
            attempt,
            error: safeFailure
        });

        if (retryLimitReached) {
            jobs.markEmailFailed(job.internalId, "retry_limit_reached");
        }
    }
};

export const deliverDueEmails = async (config: BackendConfig, jobs: JobRepository) => {
    const now = new Date().toISOString();
    jobs.expirePendingEmails(now);

    for (const job of jobs.listReadyEmailJobsDue(now, Math.max(1, config.workerConcurrency))) {
        await deliverReadyEmail(config, jobs, job);
    }
};

/**
 * Runs the full processing pipeline for one already-claimed job.
 *
 * The source file is inspected, split, zipped, and then removed after the ZIP is durable. Email
 * delivery happens after `markReady`, so Mailgun failures only affect `emailStatus` and never turn
 * a successfully generated archive into a failed processing job.
 */
export const processJob = async (
    config: BackendConfig,
    jobs: JobRepository,
    job: JobRecord
): Promise<void> => {
    const directory = jobDirectory(config.storageRoot, job.internalId);
    const chaptersDirectory = ensurePathInside(config.storageRoot, join(directory, "chapters"));
    const outputDirectory = ensurePathInside(config.storageRoot, join(directory, "output"));
    await mkdir(chaptersDirectory, {recursive: true, mode: 0o700});
    await mkdir(outputDirectory, {recursive: true, mode: 0o700});

    try {
        jobs.updateProgress(job.internalId, 10);
        const inspection = await inspectAudioFile(job.sourcePath, job.sourceFormat);
        jobs.updateProgress(job.internalId, 20, 0, inspection.chapters.length);
        const chapterPaths = await splitChapters(
            config.storageRoot,
            job.sourcePath,
            chaptersDirectory,
            inspection,
            (currentChapter, totalChapters) => {
                const progress = 20 + Math.floor((currentChapter / totalChapters) * 55);
                jobs.updateProgress(job.internalId, progress, currentChapter, totalChapters);
            }
        );

        jobs.updateProgress(job.internalId, 82);
        const archiveName = `${basename(job.displayFilename, `.${job.sourceFormat}`) || "chapters"}.zip`;
        const zipPath = await createChapterZip(
            config.storageRoot,
            outputDirectory,
            archiveName,
            chapterPaths
        );
        const completedAt = new Date();
        const expiresAt = new Date(
            completedAt.getTime() + config.jobRetentionHours * 60 * 60 * 1000
        ).toISOString();
        jobs.markReady(job.internalId, zipPath, null, completedAt.toISOString(), expiresAt);
        await rm(chaptersDirectory, {recursive: true, force: true});
        await rm(job.sourcePath, {force: true});

        const freshJob = jobs.findByInternalId(job.internalId);
        if (freshJob?.email) {
            await deliverReadyEmail(config, jobs, freshJob);
        }
    } catch (error) {
        const publicError =
            error instanceof PublicJobError
                ? error
                : new PublicJobError("PROCESSING_FAILED", String(error));
        jobs.markFailed(
            job.internalId,
            publicError.code,
            publicError.message,
            new Date().toISOString()
        );
        await rm(chaptersDirectory, {recursive: true, force: true});
    }
};

/**
 * Returns interrupted jobs to a clean queued state before the worker accepts new work.
 *
 * Jobs are recoverable only when their source upload still exists. Partial chapter files and ZIPs
 * are deleted first so the next claim starts from source media instead of reusing stale output.
 */
export const recoverInterruptedJobs = async (config: BackendConfig, jobs: JobRepository) => {
    const interruptedJobs = jobs.listProcessingJobs();

    for (const job of interruptedJobs) {
        const directory = jobDirectory(config.storageRoot, job.internalId);
        const chaptersDirectory = ensurePathInside(config.storageRoot, join(directory, "chapters"));
        const outputDirectory = ensurePathInside(config.storageRoot, join(directory, "output"));

        try {
            await access(job.sourcePath);
            await rm(chaptersDirectory, {recursive: true, force: true});
            await rm(outputDirectory, {recursive: true, force: true});
        } catch (error) {
            jobs.markFailed(
                job.internalId,
                "PROCESSING_FAILED",
                `Interrupted job could not be recovered: ${String(error)}`,
                new Date().toISOString()
            );
        }
    }

    jobs.resetProcessingJobs();
    await runCleanup(config.storageRoot, jobs);
};

/**
 * Polls SQLite for queued work until a termination signal is received.
 *
 * Each loop claims up to `workerConcurrency` jobs and tracks their promises locally. Shutdown stops
 * new claims but lets active jobs finish their current processing path before the loop exits.
 */
export const runWorkerLoop = async (config: BackendConfig, jobs: JobRepository) => {
    let shuttingDown = false;
    const activeJobs = new Set<Promise<void>>();

    const shutdown = () => {
        shuttingDown = true;
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);

    await recoverInterruptedJobs(config, jobs);

    while (true) {
        if (shuttingDown && activeJobs.size === 0) {
            break;
        }

        await runCleanup(config.storageRoot, jobs);
        await deliverDueEmails(config, jobs);

        while (activeJobs.size < config.workerConcurrency) {
            if (shuttingDown) {
                break;
            }

            const job = jobs.claimQueuedJob(new Date().toISOString());
            if (!job) {
                break;
            }

            const activeJob = processJob(config, jobs, job).finally(() => {
                activeJobs.delete(activeJob);
            });
            activeJobs.add(activeJob);
        }

        await sleep(activeJobs.size > 0 ? 500 : 2000);
    }
};
