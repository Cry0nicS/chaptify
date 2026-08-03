import {join} from "node:path";
import Database from "better-sqlite3";
import {describe, expect, it} from "vitest";

import {openDatabase, resetDatabaseForTests} from "../../server/utils/backend/database";
import {makeStorageRoot, registerBackendTestHooks} from "./helpers";

registerBackendTestHooks();

type ColumnInfo = {name: string; notnull: number};

const emailColumn = (database: Database.Database): ColumnInfo | undefined =>
    (database.prepare("PRAGMA table_info(upload_history)").all() as ColumnInfo[]).find(
        (column) => column.name === "email"
    );

/**
 * Builds a database in the shape this schema had before the upload address became scrubbable:
 * `email TEXT NOT NULL`, and no `segmented` column, so opening it exercises the nullability migration
 * and the additive `ensureColumn` path together.
 */
const writeLegacyDatabase = (storageRoot: string, email: string) => {
    const database = new Database(join(storageRoot, "database", "chaptify.sqlite"));
    database.exec(`
        CREATE TABLE upload_history (
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
            uploaded_at TEXT NOT NULL,
            completed_at TEXT
        );
    `);
    database
        .prepare(
            `
            INSERT INTO upload_history (
                public_job_id, book_title, file_size_bytes, source_format, output_format,
                email, status, email_status, uploaded_at
            )
            VALUES ('legacy-pub', 'Legacy Book', 100, 'mp3', 'mp3', ?, 'ready', 'sent',
                '2026-01-01T00:00:00.000Z')
        `
        )
        .run(email);
    expect(emailColumn(database)?.notnull).toBe(1);
    database.close();
};

describe("upload_history email nullability migration", () => {
    it("relaxes NOT NULL on an existing database without losing the stored address", async () => {
        const storageRoot = await makeStorageRoot();
        writeLegacyDatabase(storageRoot, "legacy@example.test");

        const database = openDatabase(storageRoot);

        expect(emailColumn(database)?.notnull).toBe(0);
        // The migration copies the column across verbatim: it makes a scrub possible, it never
        // performs one. Nulling the address is the sync's job, not the schema's.
        expect(
            database
                .prepare("SELECT email, book_title FROM upload_history WHERE public_job_id = ?")
                .get("legacy-pub")
        ).toEqual({email: "legacy@example.test", book_title: "Legacy Book"});
    });

    it("lets the address be scrubbed afterwards, which the old constraint refused", async () => {
        const storageRoot = await makeStorageRoot();
        writeLegacyDatabase(storageRoot, "legacy@example.test");

        const database = openDatabase(storageRoot);
        database.prepare("UPDATE upload_history SET email = NULL").run();

        expect(database.prepare("SELECT email FROM upload_history").get()).toEqual({email: null});
    });

    it("runs the additive column migration alongside it", async () => {
        const storageRoot = await makeStorageRoot();
        writeLegacyDatabase(storageRoot, "legacy@example.test");

        const columns = (
            openDatabase(storageRoot)
                .prepare("PRAGMA table_info(upload_history)")
                .all() as ColumnInfo[]
        ).map((column) => column.name);

        // `segmented` is absent from the legacy shape above; both migrations have to survive each
        // other, since the nullability one rebuilds the column list the additive one just changed.
        expect(columns).toContain("segmented");
        expect(columns).toContain("email");
    });

    it("is a no-op on a database that is already nullable", async () => {
        const storageRoot = await makeStorageRoot();

        // Fresh database: the CREATE TABLE already declares `email TEXT`, so the guard must not fire.
        const first = openDatabase(storageRoot);
        expect(emailColumn(first)?.notnull).toBe(0);
        const order = (
            first.prepare("PRAGMA table_info(upload_history)").all() as ColumnInfo[]
        ).map((column) => column.name);

        // Drop the cached singleton so the next call genuinely re-opens the file and re-runs every
        // migration against it — without this, `openDatabase` would hand back the same handle and the
        // idempotency this test exists to prove would never be exercised.
        resetDatabaseForTests();

        // Re-opening must not rebuild the column again — a guard that ignored `notnull` would move
        // `email` to the end of the order on every single boot.
        const second = openDatabase(storageRoot);
        expect(emailColumn(second)?.notnull).toBe(0);
        expect(
            (second.prepare("PRAGMA table_info(upload_history)").all() as ColumnInfo[]).map(
                (column) => column.name
            )
        ).toEqual(order);
    });

    it("declares email nullable on a freshly created database", async () => {
        const storageRoot = await makeStorageRoot();

        expect(emailColumn(openDatabase(storageRoot))?.notnull).toBe(0);
    });
});
