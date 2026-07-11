import type {
    PublicEmailStatus,
    PublicJobStatus,
    PublicProcessingErrorCode
} from "../../../shared/utils/types";
import {mkdirSync} from "node:fs";
import {dirname, resolve} from "node:path";
import Database from "better-sqlite3";
import {serializePublicError} from "./errors";

export interface JobRecord {
    id: number;
    publicJobId: string;
    internalId: string;
    displayFilename: string;
    sourceFormat: "mp3" | "m4b";
    fileSize: number;
    email: string | null;
    status: PublicJobStatus;
    progress: number;
    currentChapter: number | null;
    totalChapters: number | null;
    publicErrorCode: PublicProcessingErrorCode | null;
    publicErrorMessage: string | null;
    internalError: string | null;
    createdAt: string;
    processingStartedAt: string | null;
    completedAt: string | null;
    expiresAt: string | null;
    emailStatus: PublicEmailStatus;
    emailAttempts: number;
    emailSentAt: string | null;
    zipPath: string | null;
    sourcePath: string;
    downloadTokenHash: string | null;
}

export interface CreateJobInput {
    publicJobId: string;
    internalId: string;
    displayFilename: string;
    sourceFormat: "mp3" | "m4b";
    fileSize: number;
    email: string;
    sourcePath: string;
    createdAt: string;
}

let sharedDatabase: Database.Database | null = null;

const rowToJob = (row: Record<string, unknown>): JobRecord => ({
    id: Number(row.id),
    publicJobId: String(row.public_job_id),
    internalId: String(row.internal_id),
    displayFilename: String(row.display_filename),
    sourceFormat: row.source_format as "mp3" | "m4b",
    fileSize: Number(row.file_size),
    email: row.email === null ? null : String(row.email),
    status: row.status as PublicJobStatus,
    progress: Number(row.progress),
    currentChapter: row.current_chapter === null ? null : Number(row.current_chapter),
    totalChapters: row.total_chapters === null ? null : Number(row.total_chapters),
    publicErrorCode:
        row.public_error_code === null
            ? null
            : (row.public_error_code as PublicProcessingErrorCode),
    publicErrorMessage: row.public_error_message === null ? null : String(row.public_error_message),
    internalError: row.internal_error === null ? null : String(row.internal_error),
    createdAt: String(row.created_at),
    processingStartedAt:
        row.processing_started_at === null ? null : String(row.processing_started_at),
    completedAt: row.completed_at === null ? null : String(row.completed_at),
    expiresAt: row.expires_at === null ? null : String(row.expires_at),
    emailStatus: row.email_status as PublicEmailStatus,
    emailAttempts: Number(row.email_attempts),
    emailSentAt: row.email_sent_at === null ? null : String(row.email_sent_at),
    zipPath: row.zip_path === null ? null : String(row.zip_path),
    sourcePath: String(row.source_path),
    downloadTokenHash: row.download_token_hash === null ? null : String(row.download_token_hash)
});

export const openDatabase = (storageRoot: string): Database.Database => {
    if (sharedDatabase) {
        return sharedDatabase;
    }

    const databasePath = resolve(storageRoot, "database", "chaptify.sqlite");
    mkdirSync(dirname(databasePath), {recursive: true, mode: 0o700});
    const database = new Database(databasePath);
    database.pragma("journal_mode = WAL");
    database.pragma("busy_timeout = 5000");
    database.pragma("foreign_keys = ON");
    database.exec(`
        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            public_job_id TEXT NOT NULL UNIQUE,
            internal_id TEXT NOT NULL UNIQUE,
            display_filename TEXT NOT NULL,
            source_format TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            email TEXT,
            status TEXT NOT NULL,
            progress INTEGER NOT NULL DEFAULT 0,
            current_chapter INTEGER,
            total_chapters INTEGER,
            public_error_code TEXT,
            public_error_message TEXT,
            internal_error TEXT,
            created_at TEXT NOT NULL,
            processing_started_at TEXT,
            completed_at TEXT,
            expires_at TEXT,
            email_status TEXT NOT NULL DEFAULT 'pending',
            email_attempts INTEGER NOT NULL DEFAULT 0,
            email_sent_at TEXT,
            zip_path TEXT,
            source_path TEXT NOT NULL,
            download_token_hash TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_jobs_public_job_id ON jobs(public_job_id);
        CREATE INDEX IF NOT EXISTS idx_jobs_queued ON jobs(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_jobs_token_hash ON jobs(download_token_hash);
        CREATE INDEX IF NOT EXISTS idx_jobs_expires_at ON jobs(expires_at);
    `);
    sharedDatabase = database;

    return database;
};

export const resetDatabaseForTests = () => {
    sharedDatabase?.close();
    sharedDatabase = null;
};

export const createJobRepository = (database: Database.Database) => {
    const getByPublicIdStatement = database.prepare("SELECT * FROM jobs WHERE public_job_id = ?");
    const getByInternalIdStatement = database.prepare("SELECT * FROM jobs WHERE internal_id = ?");
    return {
        createJob(input: CreateJobInput) {
            database
                .prepare(
                    `
                    INSERT INTO jobs (
                        public_job_id,
                        internal_id,
                        display_filename,
                        source_format,
                        file_size,
                        email,
                        status,
                        progress,
                        created_at,
                        email_status,
                        source_path
                    )
                    VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, 'pending', ?)
                `
                )
                .run(
                    input.publicJobId,
                    input.internalId,
                    input.displayFilename,
                    input.sourceFormat,
                    input.fileSize,
                    input.email,
                    input.createdAt,
                    input.sourcePath
                );
        },

        countQueuedJobs(): number {
            const row = database
                .prepare(
                    "SELECT COUNT(*) AS count FROM jobs WHERE status IN ('queued', 'processing')"
                )
                .get() as {count: number};

            return row.count;
        },

        findByPublicId(publicJobId: string): JobRecord | null {
            const row = getByPublicIdStatement.get(publicJobId) as
                Record<string, unknown> | undefined;

            return row ? rowToJob(row) : null;
        },

        findByInternalId(internalId: string): JobRecord | null {
            const row = getByInternalIdStatement.get(internalId) as
                Record<string, unknown> | undefined;

            return row ? rowToJob(row) : null;
        },

        findReadyByTokenHash(tokenHash: string, now: string): JobRecord | null {
            const row = database
                .prepare(
                    `
                    SELECT * FROM jobs
                    WHERE download_token_hash = ?
                        AND status = 'ready'
                        AND expires_at IS NOT NULL
                        AND expires_at > ?
                `
                )
                .get(tokenHash, now) as Record<string, unknown> | undefined;

            return row ? rowToJob(row) : null;
        },

        claimQueuedJob(now: string): JobRecord | null {
            const transaction = database.transaction(() => {
                const row = database
                    .prepare(
                        `
                        SELECT id FROM jobs
                        WHERE status = 'queued'
                        ORDER BY created_at ASC
                        LIMIT 1
                    `
                    )
                    .get() as {id: number} | undefined;

                if (!row) {
                    return null;
                }

                const result = database
                    .prepare(
                        `
                        UPDATE jobs
                        SET status = 'processing',
                            processing_started_at = ?,
                            progress = CASE WHEN progress < 5 THEN 5 ELSE progress END
                        WHERE id = ? AND status = 'queued'
                    `
                    )
                    .run(now, row.id);

                if (result.changes !== 1) {
                    return null;
                }

                return row.id;
            });

            const id = transaction();
            if (!id) {
                return null;
            }

            const row = database.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as
                Record<string, unknown> | undefined;

            return row ? rowToJob(row) : null;
        },

        updateProgress(
            internalId: string,
            progress: number,
            currentChapter?: number,
            totalChapters?: number
        ) {
            database
                .prepare(
                    `
                    UPDATE jobs
                    SET progress = MAX(progress, ?),
                        current_chapter = COALESCE(?, current_chapter),
                        total_chapters = COALESCE(?, total_chapters)
                    WHERE internal_id = ? AND status = 'processing'
                `
                )
                .run(progress, currentChapter ?? null, totalChapters ?? null, internalId);
        },

        markFailed(
            internalId: string,
            publicErrorCode: PublicProcessingErrorCode,
            internalError: string,
            now: string
        ) {
            const publicError = serializePublicError(publicErrorCode);
            database
                .prepare(
                    `
                    UPDATE jobs
                    SET status = 'failed',
                        progress = CASE WHEN progress > 0 THEN progress ELSE 100 END,
                        public_error_code = ?,
                        public_error_message = ?,
                        internal_error = ?,
                        completed_at = ?
                    WHERE internal_id = ? AND status != 'ready'
                `
                )
                .run(publicErrorCode, publicError?.message || null, internalError, now, internalId);
        },

        markReady(
            internalId: string,
            zipPath: string,
            tokenHash: string,
            completedAt: string,
            expiresAt: string
        ) {
            database
                .prepare(
                    `
                    UPDATE jobs
                    SET status = 'ready',
                        progress = 100,
                        completed_at = ?,
                        expires_at = ?,
                        zip_path = ?,
                        download_token_hash = ?,
                        public_error_code = NULL,
                        public_error_message = NULL
                    WHERE internal_id = ? AND status = 'processing'
                `
                )
                .run(completedAt, expiresAt, zipPath, tokenHash, internalId);
        },

        incrementEmailAttempt(internalId: string) {
            database
                .prepare(
                    `
                    UPDATE jobs
                    SET email_attempts = email_attempts + 1
                    WHERE internal_id = ?
                `
                )
                .run(internalId);
        },

        markEmailSent(internalId: string, now: string) {
            database
                .prepare(
                    `
                    UPDATE jobs
                    SET email_status = 'sent',
                        email_sent_at = ?,
                        email = NULL
                    WHERE internal_id = ?
                `
                )
                .run(now, internalId);
        },

        markEmailFailed(internalId: string) {
            database
                .prepare("UPDATE jobs SET email_status = 'failed' WHERE internal_id = ?")
                .run(internalId);
        },

        resetProcessingJobs() {
            database
                .prepare(
                    `
                    UPDATE jobs
                    SET status = 'queued',
                        processing_started_at = NULL,
                        progress = 0,
                        current_chapter = NULL,
                        total_chapters = NULL
                    WHERE status = 'processing'
                `
                )
                .run();
        },

        listExpiredReadyJobs(now: string): JobRecord[] {
            const rows = database
                .prepare(
                    `
                    SELECT * FROM jobs
                    WHERE status = 'ready'
                        AND expires_at IS NOT NULL
                        AND expires_at <= ?
                `
                )
                .all(now) as Array<Record<string, unknown>>;

            return rows.map(rowToJob);
        },

        markExpired(internalId: string, now: string) {
            database
                .prepare(
                    `
                    UPDATE jobs
                    SET status = 'expired',
                        download_token_hash = NULL,
                        email = NULL,
                        zip_path = NULL,
                        completed_at = COALESCE(completed_at, ?)
                    WHERE internal_id = ?
                `
                )
                .run(now, internalId);
        },

        listFailedJobsWithFiles(): JobRecord[] {
            const rows = database
                .prepare("SELECT * FROM jobs WHERE status = 'failed'")
                .all() as Array<Record<string, unknown>>;

            return rows.map(rowToJob);
        }
    };
};

export type JobRepository = ReturnType<typeof createJobRepository>;

export const toPublicJobStatus = (job: JobRecord) => ({
    jobId: job.publicJobId,
    status: job.status,
    progress: job.progress,
    currentChapter: job.currentChapter,
    totalChapters: job.totalChapters,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    expiresAt: job.expiresAt,
    emailStatus: job.emailStatus,
    error: serializePublicError(job.publicErrorCode)
});
