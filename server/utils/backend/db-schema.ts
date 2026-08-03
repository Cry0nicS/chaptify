import {mkdirSync} from "node:fs";
import {dirname, resolve} from "node:path";
import Database from "better-sqlite3";

let sharedDatabase: Database.Database | null = null;

/**
 * MUST be called inside `openDatabase`'s write transaction. The check and the `ALTER` are not atomic on
 * their own, and three processes open this file concurrently — see the concurrency note there.
 */
const ensureColumn = (database: Database.Database, table: string, column: string, ddl: string) => {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
    }>;

    if (!columns.some((entry) => entry.name === column)) {
        database.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
};

/**
 * Drops the `NOT NULL` from `upload_history.email` on databases created before the address became
 * scrubbable. The `CREATE TABLE` above already declares it nullable, so this only fires for an
 * existing file — but it has to exist, because SQLite cannot relax a constraint in place and
 * `ensureColumn` only ever adds columns. Without it, a pre-existing database would keep `NOT NULL` and
 * every scrub would throw while a fresh one worked, which is the kind of divergence that shows up in
 * production and nowhere else.
 *
 * Four `ALTER`s rather than the usual `CREATE`+`INSERT SELECT` rebuild: this schema declares no
 * foreign keys, triggers or views, so none of the twelve-step procedure's protections are needed, and
 * naming only the column that changes means a future column cannot be silently dropped by an
 * out-of-date copy list.
 *
 * MUST be called inside `openDatabase`'s write transaction — the guard below is only sound while the
 * write lock is held. See the concurrency note there.
 *
 * Side effect worth knowing: `DROP`+`RENAME` moves `email` to the end of the column order, so a
 * migrated database lists columns differently from a fresh one. Nothing reads by ordinal position —
 * inserts name their columns and `rowToUploadHistory` reads by key — so this is cosmetic.
 */
const ensureNullableUploadHistoryEmail = (database: Database.Database) => {
    const email = (
        database.prepare("PRAGMA table_info(upload_history)").all() as Array<{
            name: string;
            notnull: number;
        }>
    ).find((entry) => entry.name === "email");

    if (!email || email.notnull === 0) {
        return;
    }

    database.exec("ALTER TABLE upload_history ADD COLUMN email_nullable TEXT");
    database.exec("UPDATE upload_history SET email_nullable = email");
    database.exec("ALTER TABLE upload_history DROP COLUMN email");
    database.exec("ALTER TABLE upload_history RENAME COLUMN email_nullable TO email");
};

export const openDatabase = (storageRoot: string): Database.Database => {
    if (sharedDatabase) {
        return sharedDatabase;
    }

    const databasePath = resolve(storageRoot, "database", "chaptify.sqlite");
    mkdirSync(dirname(databasePath), {recursive: true, mode: 0o700});
    const database = new Database(databasePath);
    // `busy_timeout` first, deliberately. It governs how every later statement reacts to contention,
    // and switching `journal_mode` needs a lock no other connection is holding — so with the default
    // zero timeout, three processes opening a not-yet-WAL database race and the losers fail instantly
    // with `database is locked` instead of waiting the moment out.
    database.pragma("busy_timeout = 5000");
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    // Every schema change below runs in ONE `BEGIN IMMEDIATE` transaction, and that is load-bearing
    // rather than tidiness.
    //
    // The API, worker and cleanup processes each open this file independently, and `docker compose up`
    // starts them together with a bare `depends_on` — which waits for the dependency to *start*, not to
    // be ready — so on the first boot after a deploy, three connections reach this block at once. Every
    // migration here is a read followed by a write (`PRAGMA table_info` then `ALTER`), which is not
    // atomic on its own: two processes both see a column missing, both try to add it, and the loser
    // throws `duplicate column name` out of `openDatabase` and crash-loops the container. Reproduced
    // with three concurrent processes against a legacy database before this was wrapped.
    //
    // `immediate` specifically: better-sqlite3's default `BEGIN` is deferred and takes no write lock
    // until the first write statement. A deferred transaction that has already read and then tries to
    // upgrade after another connection committed fails with `SQLITE_BUSY_SNAPSHOT`, which
    // `busy_timeout` does NOT retry. `BEGIN IMMEDIATE` takes the write lock up front, so a second
    // process simply waits out `busy_timeout` and then finds every guard already satisfied.
    //
    // Consequence to accept: the whole block is serialised across processes, so if a migration ever
    // outgrows the 5s `busy_timeout` the waiting processes crash and restart. `restart: unless-stopped`
    // covers that, and they succeed on the retry because the work is already done.
    database
        .transaction(() => {
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
            -- Nullable on purpose: the address is scrubbed to NULL as soon as it stops being needed
            -- for delivery, leaving the rest of the row as non-identifying usage history. NULL is the
            -- discriminator for "this row's address is gone" — see ensureNullableUploadHistoryEmail.
            email TEXT,
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
            ensureNullableUploadHistoryEmail(database);
            database
                .prepare(
                    "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)"
                )
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
        })
        .immediate();
    sharedDatabase = database;

    return database;
};

export const resetDatabaseForTests = () => {
    sharedDatabase?.close();
    sharedDatabase = null;
};
