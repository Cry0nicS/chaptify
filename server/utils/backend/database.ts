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
    outputFormat: "mp3" | "m4b";
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
    emailNextAttemptAt: string | null;
    emailLastError: string | null;
    emailMessageId: string | null;
    zipPath: string | null;
    sourcePath: string;
    downloadTokenHash: string | null;
    browserJobAccessTokenHash: string | null;
    splitWithoutChapters: boolean;
}

export interface CreateJobInput {
    publicJobId: string;
    internalId: string;
    displayFilename: string;
    sourceFormat: "mp3" | "m4b";
    outputFormat: "mp3" | "m4b";
    fileSize: number;
    email: string;
    sourcePath: string;
    createdAt: string;
    browserJobAccessTokenHash: string;
    splitWithoutChapters: boolean;
}

/**
 * One permanent row per upload, kept for historical analysis.
 *
 * Unlike `jobs`, this table is never cleaned up or anonymized: it intentionally retains the
 * inferred book name, the recipient email, and probed metadata after the operational job row has
 * been scrubbed. Fields that could not be determined (e.g. metadata of a file that failed before
 * probing) stay NULL so history can be filtered and sorted later.
 */
export interface UploadHistoryRecord {
    id: number;
    publicJobId: string;
    bookTitle: string | null;
    embeddedTitle: string | null;
    author: string | null;
    durationSeconds: number | null;
    chapterCount: number | null;
    fileSizeBytes: number;
    sourceFormat: "mp3" | "m4b";
    outputFormat: "mp3" | "m4b";
    email: string;
    status: PublicJobStatus;
    emailStatus: PublicEmailStatus;
    errorCode: PublicProcessingErrorCode | null;
    /** Whether the chapters were synthesized by the no-chapters fallback (null until probed). */
    segmented: boolean | null;
    uploadedAt: string;
    completedAt: string | null;
}

export interface UploadHistoryInspectionInput {
    durationSeconds: number;
    chapterCount: number;
    author: string | null;
    embeddedTitle: string | null;
    segmented: boolean;
}

export interface StorageReservationInput {
    ownerId: string;
    reservedBytes: number;
    createdAt: string;
    expiresAt: string;
}

export interface BrowserDownloadGrantInput {
    publicJobId: string;
    internalId: string;
    tokenHash: string;
    createdAt: string;
    expiresAt: string;
}

let sharedDatabase: Database.Database | null = null;

const rowToJob = (row: Record<string, unknown>): JobRecord => ({
    id: Number(row.id),
    publicJobId: String(row.public_job_id),
    internalId: String(row.internal_id),
    displayFilename: String(row.display_filename),
    sourceFormat: row.source_format as "mp3" | "m4b",
    outputFormat: (row.output_format ?? row.source_format) as "mp3" | "m4b",
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
    emailNextAttemptAt:
        row.email_next_attempt_at === null ? null : String(row.email_next_attempt_at),
    emailLastError: row.email_last_error === null ? null : String(row.email_last_error),
    emailMessageId: row.email_message_id === null ? null : String(row.email_message_id),
    zipPath: row.zip_path === null ? null : String(row.zip_path),
    sourcePath: String(row.source_path),
    downloadTokenHash: row.download_token_hash === null ? null : String(row.download_token_hash),
    browserJobAccessTokenHash:
        row.browser_job_access_token_hash === null
            ? null
            : String(row.browser_job_access_token_hash),
    splitWithoutChapters: Number(row.split_without_chapters) === 1
});

const rowToUploadHistory = (row: Record<string, unknown>): UploadHistoryRecord => ({
    id: Number(row.id),
    publicJobId: String(row.public_job_id),
    bookTitle: row.book_title === null ? null : String(row.book_title),
    embeddedTitle: row.embedded_title === null ? null : String(row.embedded_title),
    author: row.author === null ? null : String(row.author),
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    chapterCount: row.chapter_count === null ? null : Number(row.chapter_count),
    fileSizeBytes: Number(row.file_size_bytes),
    sourceFormat: row.source_format as "mp3" | "m4b",
    outputFormat: row.output_format as "mp3" | "m4b",
    email: String(row.email),
    status: row.status as PublicJobStatus,
    emailStatus: row.email_status as PublicEmailStatus,
    errorCode: row.error_code === null ? null : (row.error_code as PublicProcessingErrorCode),
    segmented: row.segmented === null ? null : Number(row.segmented) === 1,
    uploadedAt: String(row.uploaded_at),
    completedAt: row.completed_at === null ? null : String(row.completed_at)
});

/** Infers a human-readable book name from the uploaded filename by dropping the extension. */
const inferBookTitle = (displayFilename: string): string | null => {
    const withoutExtension = displayFilename.replace(/\.(mp3|m4b)$/i, "").trim();

    return withoutExtension || null;
};

const ensureColumn = (database: Database.Database, table: string, column: string, ddl: string) => {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
    }>;

    if (!columns.some((entry) => entry.name === column)) {
        database.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
};

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
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            public_job_id TEXT NOT NULL UNIQUE,
            internal_id TEXT NOT NULL UNIQUE,
            display_filename TEXT NOT NULL,
            source_format TEXT NOT NULL,
            output_format TEXT,
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
            email_next_attempt_at TEXT,
            email_last_error TEXT,
            email_message_id TEXT,
            zip_path TEXT,
            source_path TEXT NOT NULL,
            download_token_hash TEXT,
            browser_job_access_token_hash TEXT,
            split_without_chapters INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS storage_reservations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id TEXT NOT NULL UNIQUE,
            reserved_bytes INTEGER NOT NULL CHECK (reserved_bytes > 0),
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            released_at TEXT
        );

        CREATE TABLE IF NOT EXISTS browser_download_grants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            public_job_id TEXT NOT NULL,
            internal_id TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            used_at TEXT
        );

        CREATE TABLE IF NOT EXISTS upload_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            public_job_id TEXT NOT NULL UNIQUE,
            book_title TEXT,
            embedded_title TEXT,
            author TEXT,
            duration_seconds REAL,
            chapter_count INTEGER,
            file_size_bytes INTEGER NOT NULL,
            source_format TEXT NOT NULL,
            output_format TEXT NOT NULL,
            email TEXT NOT NULL,
            status TEXT NOT NULL,
            email_status TEXT NOT NULL,
            error_code TEXT,
            segmented INTEGER,
            uploaded_at TEXT NOT NULL,
            completed_at TEXT
        );
    `);
    ensureColumn(
        database,
        "jobs",
        "browser_job_access_token_hash",
        "browser_job_access_token_hash TEXT"
    );
    ensureColumn(database, "jobs", "output_format", "output_format TEXT");
    ensureColumn(database, "jobs", "email_next_attempt_at", "email_next_attempt_at TEXT");
    ensureColumn(database, "jobs", "email_last_error", "email_last_error TEXT");
    ensureColumn(database, "jobs", "email_message_id", "email_message_id TEXT");
    ensureColumn(
        database,
        "jobs",
        "split_without_chapters",
        "split_without_chapters INTEGER NOT NULL DEFAULT 0"
    );
    ensureColumn(database, "upload_history", "segmented", "segmented INTEGER");
    database
        .prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(1, new Date().toISOString());
    database.exec(`

        CREATE INDEX IF NOT EXISTS idx_jobs_public_job_id ON jobs(public_job_id);
        CREATE INDEX IF NOT EXISTS idx_jobs_queued ON jobs(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_jobs_email_retry ON jobs(
            status,
            email_status,
            email_next_attempt_at,
            expires_at
        );
        CREATE INDEX IF NOT EXISTS idx_jobs_token_hash ON jobs(download_token_hash);
        CREATE INDEX IF NOT EXISTS idx_jobs_browser_access_hash ON jobs(
            public_job_id,
            browser_job_access_token_hash
        );
        CREATE INDEX IF NOT EXISTS idx_jobs_expires_at ON jobs(expires_at);
        CREATE INDEX IF NOT EXISTS idx_jobs_internal_status ON jobs(internal_id, status);
        CREATE INDEX IF NOT EXISTS idx_storage_reservations_active ON storage_reservations(
            released_at,
            expires_at
        );
        CREATE INDEX IF NOT EXISTS idx_storage_reservations_owner_active
            ON storage_reservations(owner_id, released_at);
        CREATE INDEX IF NOT EXISTS idx_browser_download_grants_token
            ON browser_download_grants(token_hash, expires_at, used_at);
        CREATE INDEX IF NOT EXISTS idx_browser_download_grants_job
            ON browser_download_grants(public_job_id, internal_id);
        CREATE INDEX IF NOT EXISTS idx_browser_download_grants_retention
            ON browser_download_grants(expires_at, used_at, internal_id);
        CREATE INDEX IF NOT EXISTS idx_upload_history_uploaded_at
            ON upload_history(uploaded_at);
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
    const insertHistoryStatement = database.prepare(
        `
        INSERT OR IGNORE INTO upload_history (
            public_job_id,
            book_title,
            file_size_bytes,
            source_format,
            output_format,
            email,
            status,
            email_status,
            uploaded_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'queued', 'pending', ?)
    `
    );
    const syncHistoryStatement = database.prepare(
        `
        UPDATE upload_history
        SET status = jobs.status,
            email_status = jobs.email_status,
            error_code = jobs.public_error_code,
            completed_at = jobs.completed_at
        FROM jobs
        WHERE jobs.public_job_id = upload_history.public_job_id
            AND (upload_history.status IS NOT jobs.status
                OR upload_history.email_status IS NOT jobs.email_status
                OR upload_history.error_code IS NOT jobs.public_error_code
                OR upload_history.completed_at IS NOT jobs.completed_at)
    `
    );

    /**
     * History rows are bookkeeping: a write failure must never fail an upload or a job
     * transition, so both helpers log and continue instead of throwing.
     */
    const recordHistoryCreated = (input: CreateJobInput) => {
        try {
            insertHistoryStatement.run(
                input.publicJobId,
                inferBookTitle(input.displayFilename),
                input.fileSize,
                input.sourceFormat,
                input.outputFormat,
                input.email,
                input.createdAt
            );
        } catch (error) {
            console.warn("Upload history insert skipped", {
                publicJobId: input.publicJobId,
                error: String(error)
            });
        }
    };

    /**
     * Mirrors the live status, email status, error code, and completion time from `jobs` into
     * `upload_history`. Running the mirror as one bulk statement after each transition keeps the
     * history correct even for bulk job updates (e.g. `expirePendingEmails`), and the emails and
     * titles captured at upload time are deliberately never overwritten by later anonymization.
     */
    const syncHistoryFromJobs = () => {
        try {
            syncHistoryStatement.run();
        } catch (error) {
            console.warn("Upload history sync skipped", {error: String(error)});
        }
    };

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
                        output_format,
                        file_size,
                        email,
                        status,
                        progress,
                        created_at,
                        email_status,
                        source_path,
                        browser_job_access_token_hash,
                        split_without_chapters
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, 'pending', ?, ?, ?)
                `
                )
                .run(
                    input.publicJobId,
                    input.internalId,
                    input.displayFilename,
                    input.sourceFormat,
                    input.outputFormat,
                    input.fileSize,
                    input.email,
                    input.createdAt,
                    input.sourcePath,
                    input.browserJobAccessTokenHash,
                    input.splitWithoutChapters ? 1 : 0
                );
            recordHistoryCreated(input);
        },

        createStorageReservationIfCapacity(
            input: StorageReservationInput,
            availableBytes: number
        ): boolean {
            const transaction = database.transaction(() => {
                const row = database
                    .prepare(
                        `
                        SELECT COALESCE(SUM(reserved_bytes), 0) AS reserved
                        FROM storage_reservations
                        WHERE released_at IS NULL
                    `
                    )
                    .get() as {reserved: number};
                const reservedBytes = Number(row.reserved);

                if (availableBytes - reservedBytes < input.reservedBytes) {
                    return false;
                }

                database
                    .prepare(
                        `
                        INSERT INTO storage_reservations (
                            owner_id,
                            reserved_bytes,
                            created_at,
                            expires_at
                        )
                        VALUES (?, ?, ?, ?)
                    `
                    )
                    .run(input.ownerId, input.reservedBytes, input.createdAt, input.expiresAt);

                return true;
            });

            return transaction();
        },

        transferStorageReservation(previousOwnerId: string, nextOwnerId: string) {
            database
                .prepare(
                    `
                    UPDATE storage_reservations
                    SET owner_id = ?
                    WHERE owner_id = ? AND released_at IS NULL
                `
                )
                .run(nextOwnerId, previousOwnerId);
        },

        releaseStorageReservation(ownerId: string, now: string): boolean {
            const result = database
                .prepare(
                    `
                    UPDATE storage_reservations
                    SET released_at = ?
                    WHERE owner_id = ? AND released_at IS NULL
                `
                )
                .run(now, ownerId);

            return result.changes === 1;
        },

        releaseExpiredStorageReservations(now: string) {
            database
                .prepare(
                    `
                    UPDATE storage_reservations
                    SET released_at = ?
                    WHERE released_at IS NULL
                        AND expires_at <= ?
                        AND owner_id NOT IN (
                            SELECT internal_id
                            FROM jobs
                            WHERE status IN ('queued', 'processing', 'ready')
                        )
                `
                )
                .run(now, now);
        },

        hasActiveStorageReservation(ownerId: string): boolean {
            const row = database
                .prepare(
                    `
                    SELECT 1
                    FROM storage_reservations
                    WHERE owner_id = ? AND released_at IS NULL
                    LIMIT 1
                `
                )
                .get(ownerId);

            return Boolean(row);
        },

        getActiveStorageReservation(ownerId: string) {
            return database
                .prepare(
                    `
                    SELECT owner_id AS ownerId,
                        reserved_bytes AS reservedBytes,
                        created_at AS createdAt,
                        expires_at AS expiresAt
                    FROM storage_reservations
                    WHERE owner_id = ? AND released_at IS NULL
                    LIMIT 1
                `
                )
                .get(ownerId) as
                | {
                      ownerId: string;
                      reservedBytes: number;
                      createdAt: string;
                      expiresAt: string;
                  }
                | undefined;
        },

        createJobIfCapacity(input: CreateJobInput, maxQueuedJobs: number): boolean {
            const transaction = database.transaction(() => {
                const row = database
                    .prepare(
                        "SELECT COUNT(*) AS count FROM jobs WHERE status IN ('queued', 'processing')"
                    )
                    .get() as {count: number};

                if (row.count >= maxQueuedJobs) {
                    return false;
                }

                database
                    .prepare(
                        `
                        INSERT INTO jobs (
                            public_job_id,
                            internal_id,
                            display_filename,
                            source_format,
                            output_format,
                            file_size,
                            email,
                            status,
                            progress,
                            created_at,
                            email_status,
                            source_path,
                            browser_job_access_token_hash,
                            split_without_chapters
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, 'pending', ?, ?, ?)
                    `
                    )
                    .run(
                        input.publicJobId,
                        input.internalId,
                        input.displayFilename,
                        input.sourceFormat,
                        input.outputFormat,
                        input.fileSize,
                        input.email,
                        input.createdAt,
                        input.sourcePath,
                        input.browserJobAccessTokenHash,
                        input.splitWithoutChapters ? 1 : 0
                    );

                return true;
            });

            const created = transaction();
            if (created) {
                recordHistoryCreated(input);
            }

            return created;
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

        findReadyByPublicId(publicJobId: string, now: string): JobRecord | null {
            const row = database
                .prepare(
                    `
                    SELECT * FROM jobs
                    WHERE public_job_id = ?
                        AND status = 'ready'
                        AND expires_at IS NOT NULL
                        AND expires_at > ?
                `
                )
                .get(publicJobId, now) as Record<string, unknown> | undefined;

            return row ? rowToJob(row) : null;
        },

        findReadyByBrowserAccess(
            publicJobId: string,
            browserJobAccessTokenHash: string,
            now: string
        ): JobRecord | null {
            const row = database
                .prepare(
                    `
                    SELECT * FROM jobs
                    WHERE public_job_id = ?
                        AND browser_job_access_token_hash = ?
                        AND status = 'ready'
                        AND expires_at IS NOT NULL
                        AND expires_at > ?
                `
                )
                .get(publicJobId, browserJobAccessTokenHash, now) as
                Record<string, unknown> | undefined;

            return row ? rowToJob(row) : null;
        },

        createBrowserDownloadGrant(input: BrowserDownloadGrantInput) {
            database
                .prepare(
                    `
                    INSERT INTO browser_download_grants (
                        public_job_id,
                        internal_id,
                        token_hash,
                        created_at,
                        expires_at
                    )
                    VALUES (?, ?, ?, ?, ?)
                `
                )
                .run(
                    input.publicJobId,
                    input.internalId,
                    input.tokenHash,
                    input.createdAt,
                    input.expiresAt
                );
        },

        consumeBrowserDownloadGrant(tokenHash: string, now: string): JobRecord | null {
            const transaction = database.transaction(() => {
                const row = database
                    .prepare(
                        `
                        SELECT id, public_job_id, internal_id
                        FROM browser_download_grants
                        WHERE token_hash = ?
                            AND used_at IS NULL
                            AND expires_at > ?
                        LIMIT 1
                    `
                    )
                    .get(tokenHash, now) as
                    {id: number; public_job_id: string; internal_id: string} | undefined;

                if (!row) {
                    return null;
                }

                const job = database
                    .prepare(
                        `
                        SELECT *
                        FROM jobs
                        WHERE public_job_id = ?
                            AND internal_id = ?
                            AND status = 'ready'
                            AND expires_at IS NOT NULL
                            AND expires_at > ?
                    `
                    )
                    .get(row.public_job_id, row.internal_id, now) as
                    Record<string, unknown> | undefined;

                if (!job) {
                    return null;
                }

                const result = database
                    .prepare("UPDATE browser_download_grants SET used_at = ? WHERE id = ?")
                    .run(now, row.id);

                if (result.changes !== 1) {
                    return null;
                }

                return job;
            });
            const row = transaction();

            return row ? rowToJob(row) : null;
        },

        /**
         * Atomically claims the oldest queued job for one worker slot.
         *
         * The transaction first selects a candidate, then conditionally updates only rows that
         * are still queued. That guard is the cross-process boundary that prevents duplicate
         * processing when multiple worker loops share the same SQLite database.
         */
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

            syncHistoryFromJobs();
            const row = database.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as
                Record<string, unknown> | undefined;

            return row ? rowToJob(row) : null;
        },

        /**
         * Advances visible processing progress without allowing regressions.
         *
         * Workers report coarse milestones and per-chapter completion. Keeping progress monotonic
         * avoids UI jitter when recovery or retry paths write an older milestone after a newer one.
         */
        updateProgress(
            internalId: string,
            progress: number,
            currentChapter?: number,
            totalChapters?: number
        ) {
            try {
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
            } catch (error) {
                // Progress is cosmetic; a transient write failure (e.g. SQLITE_BUSY under contention)
                // must never fail an otherwise-successful job.
                console.warn("Progress update skipped", {internalId, error: String(error)});
            }
        },

        markFailed(
            internalId: string,
            publicErrorCode: PublicProcessingErrorCode,
            internalError: string,
            now: string
        ): boolean {
            const publicError = serializePublicError(publicErrorCode);
            const result = database
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
            syncHistoryFromJobs();

            return result.changes === 1;
        },

        /**
         * Finalizes a successfully processed job and records the download-token hash.
         *
         * The raw token is returned only to the worker so it can be embedded in the completion
         * email. SQLite stores the hash, which means a database read alone cannot recover a usable
         * ZIP download URL.
         */
        markReady(
            internalId: string,
            zipPath: string,
            tokenHash: string | null,
            completedAt: string,
            expiresAt: string
        ): boolean {
            const result = database
                .prepare(
                    `
                    UPDATE jobs
                    SET status = 'ready',
                        progress = 100,
                        completed_at = ?,
                        expires_at = ?,
                        zip_path = ?,
                        download_token_hash = ?,
                        email_next_attempt_at = ?,
                        public_error_code = NULL,
                        public_error_message = NULL
                    WHERE internal_id = ? AND status = 'processing'
                `
                )
                .run(completedAt, expiresAt, zipPath, tokenHash, completedAt, internalId);
            syncHistoryFromJobs();

            return result.changes === 1;
        },

        /**
         * Atomically leases a ready job's completion email for delivery.
         *
         * Both the inline post-processing path and the periodic retry loop can select the same due
         * job; this conditional update lets only one caller proceed by pushing `email_next_attempt_at`
         * past `now`, so a concurrent claimer sees it as not-yet-due and backs off. A failed send
         * overwrites the lease with the real backoff time, and a crash mid-send lets the lease expire
         * so delivery is retried (delivery remains at-least-once).
         */
        claimEmailDelivery(internalId: string, now: string, leaseUntil: string): boolean {
            const result = database
                .prepare(
                    `
                    UPDATE jobs
                    SET email_next_attempt_at = ?
                    WHERE internal_id = ?
                        AND status = 'ready'
                        AND email_status = 'pending'
                        AND email IS NOT NULL
                        AND (email_next_attempt_at IS NULL OR email_next_attempt_at <= ?)
                `
                )
                .run(leaseUntil, internalId, now);

            return result.changes === 1;
        },

        recordEmailAttempt(
            internalId: string,
            nextAttemptAt: string | null,
            safeFailure: string | null
        ) {
            database
                .prepare(
                    `
                    UPDATE jobs
                    SET email_attempts = email_attempts + 1,
                        email_next_attempt_at = ?,
                        email_last_error = ?
                    WHERE internal_id = ?
                `
                )
                .run(nextAttemptAt, safeFailure, internalId);
        },

        /**
         * Records successful email delivery and drops the submitted address.
         *
         * Processing readiness is independent of Mailgun delivery. Once delivery succeeds, the
         * address is no longer needed for retries and is removed from persistence.
         *
         * The update is conditional: it only applies while the job is still ready, unexpired,
         * email-pending, and owns the given lease. If cleanup expired or anonymized the job during
         * the Mailgun request, no row matches and `false` is returned so the caller does not report a
         * delivery that points at an already-invalidated link.
         */
        markEmailSent(internalId: string, now: string, leaseUntil: string): boolean {
            const result = database
                .prepare(
                    `
                    UPDATE jobs
                    SET email_status = 'sent',
                        email_sent_at = ?,
                        email = NULL,
                        email_next_attempt_at = NULL,
                        email_last_error = NULL,
                        email_message_id = COALESCE(?, email_message_id)
                    WHERE internal_id = ?
                        AND status = 'ready'
                        AND email_status = 'pending'
                        AND expires_at IS NOT NULL
                        AND expires_at > ?
                        AND email_next_attempt_at = ?
                `
                )
                .run(now, null, internalId, now, leaseUntil);
            syncHistoryFromJobs();

            return result.changes === 1;
        },

        markEmailFailed(internalId: string, safeFailure: string | null = null) {
            database
                .prepare(
                    `
                    UPDATE jobs
                    SET email_status = 'failed',
                        email = NULL,
                        email_next_attempt_at = NULL,
                        email_last_error = COALESCE(?, email_last_error)
                    WHERE internal_id = ?
                `
                )
                .run(safeFailure, internalId);
            syncHistoryFromJobs();
        },

        listReadyEmailJobsDue(now: string, limit: number): JobRecord[] {
            const rows = database
                .prepare(
                    `
                    SELECT * FROM jobs
                    WHERE status = 'ready'
                        AND email_status = 'pending'
                        AND email IS NOT NULL
                        AND expires_at IS NOT NULL
                        AND expires_at > ?
                        AND (email_next_attempt_at IS NULL OR email_next_attempt_at <= ?)
                    ORDER BY COALESCE(email_next_attempt_at, completed_at, created_at) ASC
                    LIMIT ?
                `
                )
                .all(now, now, limit) as Array<Record<string, unknown>>;

            return rows.map(rowToJob);
        },

        expirePendingEmails(now: string) {
            database
                .prepare(
                    `
                    UPDATE jobs
                    SET email_status = 'failed',
                        email = NULL,
                        email_next_attempt_at = NULL,
                        email_last_error = 'expired'
                    WHERE status = 'ready'
                        AND email_status = 'pending'
                        AND expires_at IS NOT NULL
                        AND expires_at <= ?
                `
                )
                .run(now);
            syncHistoryFromJobs();
        },

        /**
         * Requeues jobs left in progress by a stopped worker.
         *
         * Recovery removes partial chapter and ZIP artifacts before this update runs, so a
         * restarted worker can safely claim the job from the beginning.
         */
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
            syncHistoryFromJobs();
        },

        listProcessingJobs(): JobRecord[] {
            const rows = database
                .prepare("SELECT * FROM jobs WHERE status = 'processing'")
                .all() as Array<Record<string, unknown>>;

            return rows.map(rowToJob);
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

        /**
         * Makes an expired job non-downloadable after file cleanup.
         *
         * Clearing both token hashes invalidates emailed links and browser-session downloads while
         * preserving the public job record for status display.
         */
        markExpired(internalId: string, now: string): boolean {
            const result = database
                .prepare(
                    `
                    UPDATE jobs
                    SET status = 'expired',
                        download_token_hash = NULL,
                        browser_job_access_token_hash = NULL,
                        email = NULL,
                        zip_path = NULL,
                        completed_at = COALESCE(completed_at, ?)
                    WHERE internal_id = ?
                `
                )
                .run(now, internalId);
            database
                .prepare(
                    `
                    UPDATE browser_download_grants
                    SET used_at = COALESCE(used_at, ?)
                    WHERE internal_id = ? AND used_at IS NULL
                `
                )
                .run(now, internalId);
            syncHistoryFromJobs();

            return result.changes === 1;
        },

        purgeBrowserDownloadGrants(now: string, usedBefore: string): number {
            const result = database
                .prepare(
                    `
                    DELETE FROM browser_download_grants
                    WHERE expires_at <= ?
                        OR (used_at IS NOT NULL AND used_at <= ?)
                        OR internal_id IN (
                            SELECT internal_id
                            FROM jobs
                            WHERE status = 'expired'
                        )
                `
                )
                .run(now, usedBefore);

            return result.changes;
        },

        listFailedJobsWithFiles(): JobRecord[] {
            const rows = database
                .prepare("SELECT * FROM jobs WHERE status = 'failed'")
                .all() as Array<Record<string, unknown>>;

            return rows.map(rowToJob);
        },

        listKnownInternalIds(): string[] {
            const rows = database.prepare("SELECT internal_id FROM jobs").all() as Array<{
                internal_id: string;
            }>;

            return rows.map((row) => row.internal_id);
        },

        anonymizeFailedJob(internalId: string) {
            database
                .prepare(
                    `
                    UPDATE jobs
                    SET email = NULL,
                        display_filename = 'audiobook'
                    WHERE internal_id = ? AND status = 'failed'
                `
                )
                .run(internalId);
        },

        /**
         * Enriches the history row with facts probed by the worker. Jobs that fail before the
         * probe simply keep NULLs here, which is the filterable "not available" signal.
         */
        recordHistoryInspection(publicJobId: string, input: UploadHistoryInspectionInput) {
            try {
                database
                    .prepare(
                        `
                        UPDATE upload_history
                        SET duration_seconds = ?,
                            chapter_count = ?,
                            author = ?,
                            embedded_title = ?,
                            segmented = ?
                        WHERE public_job_id = ?
                    `
                    )
                    .run(
                        input.durationSeconds,
                        input.chapterCount,
                        input.author,
                        input.embeddedTitle,
                        input.segmented ? 1 : 0,
                        publicJobId
                    );
            } catch (error) {
                console.warn("Upload history inspection update skipped", {
                    publicJobId,
                    error: String(error)
                });
            }
        },

        listUploadHistory(limit = 100, offset = 0): UploadHistoryRecord[] {
            const rows = database
                .prepare(
                    `
                    SELECT * FROM upload_history
                    ORDER BY uploaded_at DESC, id DESC
                    LIMIT ? OFFSET ?
                `
                )
                .all(limit, offset) as Array<Record<string, unknown>>;

            return rows.map(rowToUploadHistory);
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
