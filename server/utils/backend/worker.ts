import type {BackendConfig} from "./config";
import type {JobRecord, JobRepository} from "./database";
import {mkdir, rm} from "node:fs/promises";
import {basename, join} from "node:path";
import {createChapterZip} from "./archive";
import {runCleanup} from "./cleanup";
import {normalizeBaseUrl} from "./config";
import {PublicJobError} from "./errors";
import {createDownloadToken, hashDownloadToken} from "./ids";
import {createMailgunService} from "./mailgun";
import {inspectAudioFile, splitChapters} from "./media";
import {ensurePathInside, jobDirectory} from "./paths";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const deliverReadyEmail = async (
    config: BackendConfig,
    jobs: JobRepository,
    job: JobRecord,
    token: string
): Promise<void> => {
    const mailgun = createMailgunService(config);
    const downloadUrl = `${normalizeBaseUrl(config.appBaseUrl || "http://localhost:3000")}/api/download/${token}`;

    while (job.email && job.emailAttempts < config.emailRetryAttempts) {
        jobs.incrementEmailAttempt(job.internalId);

        try {
            await mailgun.sendCompletionEmail({
                to: job.email,
                downloadUrl,
                expiresInHours: config.jobRetentionHours
            });
            jobs.markEmailSent(job.internalId, new Date().toISOString());
            return;
        } catch (error) {
            console.warn("Completion email attempt failed", {
                jobId: job.publicJobId,
                attempt: job.emailAttempts + 1,
                error: String(error)
            });
        }

        const updatedJob = jobs.findByInternalId(job.internalId);
        if (!updatedJob) {
            break;
        }

        job = updatedJob;
    }

    jobs.markEmailFailed(job.internalId);
};

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
        const token = createDownloadToken();
        const completedAt = new Date();
        const expiresAt = new Date(
            completedAt.getTime() + config.jobRetentionHours * 60 * 60 * 1000
        ).toISOString();
        jobs.markReady(
            job.internalId,
            zipPath,
            hashDownloadToken(token),
            completedAt.toISOString(),
            expiresAt
        );
        await rm(chaptersDirectory, {recursive: true, force: true});
        await rm(job.sourcePath, {force: true});

        const freshJob = jobs.findByInternalId(job.internalId);
        if (freshJob?.email) {
            await deliverReadyEmail(config, jobs, freshJob, token);
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

export const recoverInterruptedJobs = async (config: BackendConfig, jobs: JobRepository) => {
    jobs.resetProcessingJobs();
    await runCleanup(config.storageRoot, jobs);
};

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
