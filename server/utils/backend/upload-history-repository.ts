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
     * `upload_history`. Running the mirror as one bulk statement after each transition keeps the
     * history correct even for bulk job updates (e.g. `expirePendingEmails`), and the emails and
     * titles captured at upload time are deliberately never overwritten by later anonymization.
     */
    const syncFromJobs = () => {
        try {
            syncHistoryStatement.run();
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
