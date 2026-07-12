import {createHash, randomBytes} from "node:crypto";

/**
 * Public, non-secret identifier used in status URLs and user-facing API responses.
 *
 * It is safe to expose, but it is not sufficient for browser ZIP download access.
 */
export const createPublicId = (): string => randomBytes(18).toString("base64url");

/**
 * Private storage identifier used for job directories and database lookups.
 *
 * This value is never returned to the browser so internal paths cannot be inferred from public
 * status URLs.
 */
export const createInternalId = (): string => randomBytes(16).toString("hex");

/**
 * Secret bearer token embedded in the emailed ZIP download link.
 *
 * Only the SHA-256 hash is persisted, which keeps database contents from being enough to download
 * an archive.
 */
export const createDownloadToken = (): string => randomBytes(32).toString("base64url");

/**
 * Secret bearer token returned once to the uploading browser for same-session downloads.
 *
 * It is separate from the emailed download token so browser restore does not expose or depend on
 * the Mailgun link credential.
 */
export const createBrowserJobAccessToken = (): string => randomBytes(32).toString("base64url");

export const hashDownloadToken = (token: string): string =>
    createHash("sha256").update(token).digest("hex");

export const hashBrowserJobAccessToken = (token: string): string =>
    createHash("sha256").update(token).digest("hex");
