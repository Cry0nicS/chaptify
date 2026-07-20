import {mkdirSync} from "node:fs";
import {dirname, resolve} from "node:path";
import Database from "better-sqlite3";

let sharedDatabase: Database.Database | null = null;

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
            kind TEXT NOT NULL DEFAULT 'split',
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
            output_path TEXT,
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
