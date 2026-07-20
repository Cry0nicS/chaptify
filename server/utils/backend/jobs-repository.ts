import type Database from "better-sqlite3";
import type {
    PublicEmailStatus,
    PublicJobStatus,
    PublicProcessingErrorCode
} from "../../../shared/utils/types";
import {serializePublicError} from "./errors";
import {createUploadHistoryRepository} from "./upload-history-repository";

/**
 * Distinguishes the two job pipelines that share this table: `split` cuts an audiobook into
 * per-chapter files and zips them; `convert` transcodes the whole file to another format.
 */
export type JobKind = "split" | "convert";

export interface JobRecord {
    id: number;
    publicJobId: string;
    internalId: string;
    kind: JobKind;
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
    outputPath: string | null;
    sourcePath: string;
    downloadTokenHash: string | null;
    browserJobAccessTokenHash: string | null;
    splitWithoutChapters: boolean;
}

export interface CreateJobInput {
    publicJobId: string;
    internalId: string;
    kind: JobKind;
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

const rowToJob = (row: Record<string, unknown>): JobRecord => ({
    id: Number(row.id),
    publicJobId: String(row.public_job_id),
    internalId: String(row.internal_id),
    // Normalize to a known kind: anything that is not "convert" (including a legacy NULL from
    // before this column existed) falls back to the safe "split" default the column also uses.
    kind: (row.kind === "convert" ? "convert" : "split") as JobKind,
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
    outputPath: row.output_path === null ? null : String(row.output_path),
    sourcePath: String(row.source_path),
    downloadTokenHash: row.download_token_hash === null ? null : String(row.download_token_hash),
    browserJobAccessTokenHash:
        row.browser_job_access_token_hash === null
            ? null
            : String(row.browser_job_access_token_hash),
    splitWithoutChapters: Number(row.split_without_chapters) === 1
});

export const createJobRepository = (database: Database.Database) => {
    const history = createUploadHistoryRepository(database);
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
                        kind,
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
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, 'pending', ?, ?, ?)
                `
                )
                .run(
                    input.publicJobId,
                    input.internalId,
                    input.kind,
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
            history.recordCreated(input);
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
                            kind,
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
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, 'pending', ?, ?, ?)
                    `
                    )
                    .run(
                        input.publicJobId,
                        input.internalId,
                        input.kind,
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
                history.recordCreated(input);
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

            history.syncFromJobs();
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
            history.syncFromJobs();

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
            outputPath: string,
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
                        output_path = ?,
                        download_token_hash = ?,
                        email_next_attempt_at = ?,
                        public_error_code = NULL,
                        public_error_message = NULL
                    WHERE internal_id = ? AND status = 'processing'
                `
                )
                .run(completedAt, expiresAt, outputPath, tokenHash, completedAt, internalId);
            history.syncFromJobs();

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
            history.syncFromJobs();

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
            history.syncFromJobs();
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
            history.syncFromJobs();
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
            history.syncFromJobs();
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
                        output_path = NULL,
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
            history.syncFromJobs();

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
        recordHistoryInspection: history.recordInspection,
        listUploadHistory: history.list
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
