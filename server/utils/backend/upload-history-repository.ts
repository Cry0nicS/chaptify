import type Database from "better-sqlite3";
import type {
    PublicEmailStatus,
    PublicJobStatus,
    PublicProcessingErrorCode
} from "../../../shared/utils/types";
import type {CreateJobInput} from "./jobs-repository";

/**
 * One permanent row per upload, kept for historical analysis.
 *
 * The row is permanent; the address in it is not. `email` is scrubbed to NULL the moment the
 * corresponding `jobs.email` is scrubbed — see `scrubScrubbedJobEmails` — leaving the inferred book
 * name, timestamps, sizes, formats, status and probed metadata as non-identifying usage history that
 * can be kept indefinitely.
 *
 * This reverses the table's original design, which deliberately retained the address forever. The
 * reason: an address that has already delivered its download link has no remaining purpose, so keeping
 * it is pure liability. Replacing it with an irreversible per-uploader hash was considered and
 * rejected — a keyed hash whose secret the operator still holds is *pseudonymous*, not anonymous, so
 * it would have preserved exactly the liability the change exists to remove (GDPR Art. 4(5) and
 * Recital 26; Art. 11(2) is unavailable while the secret is held). NULL discharges it, at the cost of
 * per-person attribution: unique- and repeat-uploader counts are not answerable after delivery.
 *
 * Fields that could not be determined (e.g. metadata of a file that failed before probing) stay NULL
 * so history can be filtered and sorted later.
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
    /** NULL once the address has been scrubbed, which is the normal state for any delivered upload. */
    email: string | null;
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
    // Guarded like every other nullable column here. Without the guard a scrubbed row would surface
    // the literal string "null" as an address, so the scrub would look like it had silently failed.
    email: row.email === null ? null : String(row.email),
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

/**
 * Owns the permanent `upload_history` table. Split out of the job repository so the historical
 * analytics concern (create row, mirror job state, enrich after probe, list) is isolated from the
 * operational job/reservation/grant logic. Shares the same SQLite handle as the job repository.
 */
export const createUploadHistoryRepository = (database: Database.Database) => {
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
     * Enforces the one rule that governs the address: a history row holds an email only while the
     * operational job row still does.
     *
     * Deliberately a separate statement rather than another column on the mirror above. The mirror
     * only fires when one of its four columns actually differs, so a transition that nulls
     * `jobs.email` without touching status, email status, error code or completion time would not
     * trigger it — the address would survive. This statement's own `WHERE` is the condition, so it
     * cannot be skipped that way, and it is idempotent: it touches only rows that still need it.
     *
     * That also makes it self-backfilling. Rows written before this behaviour existed, whose jobs were
     * scrubbed long ago, are cleaned up by the first sweep after deployment — no separate migration.
     *
     * `UPDATE ... FROM` needs SQLite 3.33+, which the mirror above already requires.
     */
    const scrubScrubbedJobEmailsStatement = database.prepare(
        `
        UPDATE upload_history
        SET email = NULL
        FROM jobs
        WHERE jobs.public_job_id = upload_history.public_job_id
            AND jobs.email IS NULL
            AND upload_history.email IS NOT NULL
    `
    );

    /**
     * History rows are bookkeeping: a write failure must never fail an upload or a job
     * transition, so both helpers log and continue instead of throwing.
     */
    const recordCreated = (input: CreateJobInput) => {
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
     * `upload_history`, then scrubs the address from any row whose job no longer holds one. Running
     * both as bulk statements after each transition keeps the history correct even for bulk job
     * updates (e.g. `expirePendingEmails`).
     *
     * The scrub rides along here rather than being wired into each of the five places that null
     * `jobs.email` because this is already called after every job transition — so the invariant holds
     * without five separate call sites to keep in step, and a future transition that nulls the address
     * inherits the behaviour instead of having to remember it. Titles captured at upload time are still
     * never overwritten; only the address is.
     */
    const syncFromJobs = () => {
        try {
            syncHistoryStatement.run();
            scrubScrubbedJobEmailsStatement.run();
        } catch (error) {
            console.warn("Upload history sync skipped", {error: String(error)});
        }
    };

    return {
        recordCreated,
        syncFromJobs,
        /**
         * Enriches the history row with facts probed by the worker. Jobs that fail before the
         * probe simply keep NULLs here, which is the filterable "not available" signal.
         */
        recordInspection(publicJobId: string, input: UploadHistoryInspectionInput) {
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
        list(limit = 100, offset = 0): UploadHistoryRecord[] {
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

export type UploadHistoryRepository = ReturnType<typeof createUploadHistoryRepository>;
