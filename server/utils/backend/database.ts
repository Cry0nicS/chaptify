/*
 * Barrel for the backend persistence layer. Implementation is split across:
 *   - db-schema.ts               connection, pragmas, table/index DDL, migrations
 *   - jobs-repository.ts         jobs, storage reservations, browser download grants
 *   - upload-history-repository.ts  the permanent upload_history analytics table
 */
export * from "./db-schema";
export * from "./jobs-repository";
export * from "./upload-history-repository";
