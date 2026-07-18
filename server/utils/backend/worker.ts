import type {BackendConfig} from "./config";
import type {JobRecord, JobRepository} from "./database";
import {access, mkdir, rm, stat} from "node:fs/promises";
import {basename, join} from "node:path";
import {createChapterZip as createChapterZipDefault} from "./archive";
import {runCleanup} from "./cleanup";
import {normalizeBaseUrl} from "./config";
import {PublicJobError} from "./errors";
import {createSignedDownloadToken} from "./ids";
import {createMailgunService} from "./mailgun";
import {
    inspectAudioFile as inspectAudioFileDefault,
    splitChapters as splitChaptersDefault
} from "./media";
import {ensurePathInside, jobDirectory} from "./paths";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How long a claimed completion email is leased before another worker may retry it. Longer than the
 * Mailgun request timeout so a normal send finishes first; a crash mid-send releases it afterwards.
 */
const EMAIL_SEND_LEASE_MS = 5 * 60_000;

const safeDiagnostic = (error: unknown): string =>
    error instanceof Error ? error.name || "Error" : "Unknown error";

const cleanupProcessingArtifacts = async (
    internalId: string,
    chaptersDirectory: string | null,
    outputDirectory: string | null,
    removePath: typeof rm
) => {
    for (const directory of [chaptersDirectory, outputDirectory]) {
        if (!directory) {
            continue;
        }

        try {
            await removePath(directory, {recursive: true, force: true});
        } catch (error) {
            console.warn("Processing artifact cleanup failed", {
                jobId: internalId,
                error: safeDiagnostic(error)
            });
        }
    }
};

const cleanupReadyIntermediates = async (
    internalId: string,
    chaptersDirectory: string,
    sourcePath: string,
    removePath: typeof rm
) => {
    for (const cleanup of [
        async () => {
            await removePath(chaptersDirectory, {recursive: true, force: true});
        },
        async () => {
            await removePath(sourcePath, {force: true});
        }
    ]) {
        try {
            await cleanup();
        } catch (error) {
            console.warn("Ready job intermediate cleanup failed", {
                jobId: internalId,
                error: safeDiagnostic(error)
            });
        }
    }
};

export interface ProcessJobDependencies {
    makeDirectory?: typeof mkdir;
    removePath?: typeof rm;
    statPath?: typeof stat;
    inspectAudioFile?: typeof inspectAudioFileDefault;
    splitChapters?: typeof splitChaptersDefault;
    createChapterZip?: typeof createChapterZipDefault;
    deliverReadyEmail?: typeof deliverReadyEmail;
    beforeMarkReady?: () => Promise<void> | void;
    /**
     * External abort signal used by the worker loop to stop this job on shutdown. When it fires the
     * job is treated as interrupted (left `processing` for recovery) rather than failed.
     */
    signal?: AbortSignal;
}

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

    // Claim delivery atomically so the inline post-processing path and the retry loop cannot both
    // send this job's email across the Mailgun await.
    const leaseUntil = new Date(Date.now() + EMAIL_SEND_LEASE_MS).toISOString();
    if (!jobs.claimEmailDelivery(job.internalId, new Date().toISOString(), leaseUntil)) {
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
    job: JobRecord,
    dependencies: ProcessJobDependencies = {}
): Promise<void> => {
    const makeDirectory = dependencies.makeDirectory || mkdir;
    const removePath = dependencies.removePath || rm;
    const statPath = dependencies.statPath || stat;
    const inspectAudioFile = dependencies.inspectAudioFile || inspectAudioFileDefault;
    const splitChapters = dependencies.splitChapters || splitChaptersDefault;
    const createChapterZip = dependencies.createChapterZip || createChapterZipDefault;
    const deliverEmail = dependencies.deliverReadyEmail || deliverReadyEmail;
    const directory = jobDirectory(config.storageRoot, job.internalId);
    let chaptersDirectory: string | null = null;
    let outputDirectory: string | null = null;
    let readyTransitionSucceeded = false;
    const abortController = new AbortController();
    const externalSignal = dependencies.signal;
    const onExternalAbort = () => abortController.abort();
    if (externalSignal?.aborted) {
        abortController.abort();
    } else {
        externalSignal?.addEventListener("abort", onExternalAbort, {once: true});
    }
    const deadlineMs = Date.now() + config.jobProcessingTimeoutSeconds * 1000;
    const deadlineTimer = setTimeout(() => {
        abortController.abort();
    }, config.jobProcessingTimeoutSeconds * 1000);
    const mediaOptions = {
        maxAudiobookDurationSeconds: config.maxAudiobookDurationSeconds,
        maxChapters: config.maxChapters,
        ffprobeTimeoutMs: config.ffprobeTimeoutSeconds * 1000,
        ffmpegChapterTimeoutMs: config.ffmpegChapterTimeoutSeconds * 1000,
        deadlineMs,
        signal: abortController.signal
    };

    try {
        chaptersDirectory = ensurePathInside(config.storageRoot, join(directory, "chapters"));
        outputDirectory = ensurePathInside(config.storageRoot, join(directory, "output"));
        await makeDirectory(chaptersDirectory, {recursive: true, mode: 0o700});
        await makeDirectory(outputDirectory, {recursive: true, mode: 0o700});

        jobs.updateProgress(job.internalId, 10);
        const inspection = await inspectAudioFile(job.sourcePath, job.sourceFormat, mediaOptions);
        jobs.updateProgress(job.internalId, 20, 0, inspection.chapters.length);
        const chapterPaths = await splitChapters(
            config.storageRoot,
            job.sourcePath,
            chaptersDirectory,
            inspection,
            (currentChapter, totalChapters) => {
                const progress = 20 + Math.floor((currentChapter / totalChapters) * 55);
                jobs.updateProgress(job.internalId, progress, currentChapter, totalChapters);
            },
            mediaOptions
        );

        jobs.updateProgress(job.internalId, 82);
        const archiveName = `${basename(job.displayFilename, `.${job.sourceFormat}`) || "chapters"}.zip`;
        const zipPath = await createChapterZip(
            config.storageRoot,
            outputDirectory,
            archiveName,
            chapterPaths,
            {
                signal: abortController.signal
            }
        );
        const zipStats = await statPath(zipPath);
        if (zipStats.size === 0) {
            throw new PublicJobError("ZIP_CREATION_FAILED", "ZIP archive was empty");
        }
        await dependencies.beforeMarkReady?.();
        const completedAt = new Date();
        const expiresAt = new Date(
            completedAt.getTime() + config.jobRetentionHours * 60 * 60 * 1000
        ).toISOString();
        const markedReady = jobs.markReady(
            job.internalId,
            zipPath,
            null,
            completedAt.toISOString(),
            expiresAt
        );
        if (!markedReady) {
            console.warn("Ready transition skipped for stale job state", {
                jobId: job.publicJobId
            });
            return;
        }
        readyTransitionSucceeded = true;

        await cleanupReadyIntermediates(
            job.internalId,
            chaptersDirectory,
            job.sourcePath,
            removePath
        );

        const freshJob = jobs.findByInternalId(job.internalId);
        if (freshJob?.status === "ready" && freshJob.email) {
            await deliverEmail(config, jobs, freshJob);
        }
    } catch (error) {
        if (readyTransitionSucceeded) {
            console.warn("Ready job post-processing step failed", {
                jobId: job.publicJobId,
                error: safeDiagnostic(error)
            });
            return;
        }

        if (externalSignal?.aborted) {
            // Worker shutdown aborted this job mid-flight. Leave it in 'processing' with its source
            // intact so recoverInterruptedJobs requeues it on the next start instead of turning a
            // routine restart into a permanent failure for the user.
            console.warn("Job processing aborted for shutdown; deferring to recovery", {
                jobId: job.publicJobId
            });
            await cleanupProcessingArtifacts(
                job.internalId,
                chaptersDirectory,
                outputDirectory,
                removePath
            );
            return;
        }

        const publicError =
            error instanceof PublicJobError
                ? error
                : new PublicJobError("PROCESSING_FAILED", String(error));
        const markedFailed = jobs.markFailed(
            job.internalId,
            publicError.code,
            publicError.message,
            new Date().toISOString()
        );
        await cleanupProcessingArtifacts(
            job.internalId,
            chaptersDirectory,
            outputDirectory,
            removePath
        );
        if (markedFailed) {
            jobs.releaseStorageReservation(job.internalId, new Date().toISOString());
        }
    } finally {
        clearTimeout(deadlineTimer);
        externalSignal?.removeEventListener("abort", onExternalAbort);
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
            const markedFailed = jobs.markFailed(
                job.internalId,
                "PROCESSING_FAILED",
                `Interrupted job could not be recovered: ${String(error)}`,
                new Date().toISOString()
            );
            if (markedFailed) {
                jobs.releaseStorageReservation(job.internalId, new Date().toISOString());
            }
        }
    }

    jobs.resetProcessingJobs();
    await runCleanup(config, jobs);
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
    const activeControllers = new Set<AbortController>();
    const cleanupIntervalMs = config.cleanupIntervalSeconds * 1000;

    const shutdown = () => {
        shuttingDown = true;
        // Abort in-flight work so FFmpeg/ffprobe/ZIP stop promptly instead of running until the
        // per-job deadline. Aborted jobs stay 'processing' and are requeued by recovery on restart.
        for (const controller of activeControllers) {
            controller.abort();
        }
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);

    await recoverInterruptedJobs(config, jobs);
    // recoverInterruptedJobs already ran a cleanup pass; start the interval clock from here so the
    // worker does not re-scan storage on its very first loop iteration.
    let lastCleanupMs = Date.now();

    while (true) {
        if (shuttingDown && activeJobs.size === 0) {
            break;
        }

        if (!shuttingDown && Date.now() - lastCleanupMs >= cleanupIntervalMs) {
            await runCleanup(config, jobs);
            lastCleanupMs = Date.now();
        }
        await deliverDueEmails(config, jobs);

        while (activeJobs.size < config.workerConcurrency) {
            if (shuttingDown) {
                break;
            }

            const job = jobs.claimQueuedJob(new Date().toISOString());
            if (!job) {
                break;
            }

            const controller = new AbortController();
            activeControllers.add(controller);
            const activeJob = processJob(config, jobs, job, {signal: controller.signal})
                .catch((error) => {
                    console.error("Worker job promise rejected", {
                        jobId: job.publicJobId,
                        error: safeDiagnostic(error)
                    });
                })
                .finally(() => {
                    activeJobs.delete(activeJob);
                    activeControllers.delete(controller);
                });
            activeJobs.add(activeJob);
        }

        await sleep(activeJobs.size > 0 ? 500 : 2000);
    }
};
