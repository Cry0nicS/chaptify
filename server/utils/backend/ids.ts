import {Buffer} from "node:buffer";
import {createHash, createHmac, randomBytes, timingSafeEqual} from "node:crypto";

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

export const createSignedDownloadToken = (input: {
    publicJobId: string;
    internalId: string;
    expiresAt: string;
    signingSecret: string;
}): string => {
    const payload = Buffer.from(
        JSON.stringify({
            jobId: input.publicJobId,
            exp: input.expiresAt
        })
    ).toString("base64url");
    const signature = createHmac("sha256", input.signingSecret)
        .update(`${payload}.${input.internalId}.${input.expiresAt}`)
        .digest("base64url");

    return `${payload}.${signature}`;
};

export const parseSignedDownloadToken = (
    token: string
): {publicJobId: string; expiresAt: string; signature: string; payload: string} | null => {
    const [payload, signature] = token.split(".");

    if (!payload || !signature || token.split(".").length !== 2) {
        return null;
    }

    try {
        const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
            jobId?: unknown;
            exp?: unknown;
        };

        if (typeof parsed.jobId !== "string" || typeof parsed.exp !== "string") {
            return null;
        }

        return {
            publicJobId: parsed.jobId,
            expiresAt: parsed.exp,
            signature,
            payload
        };
    } catch {
        return null;
    }
};

export const verifySignedDownloadToken = (input: {
    token: string;
    internalId: string;
    expiresAt: string;
    signingSecret: string;
}): boolean => {
    const parsed = parseSignedDownloadToken(input.token);

    if (!parsed || parsed.expiresAt !== input.expiresAt) {
        return false;
    }

    const expected = createHmac("sha256", input.signingSecret)
        .update(`${parsed.payload}.${input.internalId}.${input.expiresAt}`)
        .digest("base64url");
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(parsed.signature);

    return (
        expectedBuffer.length === actualBuffer.length &&
        timingSafeEqual(expectedBuffer, actualBuffer)
    );
};
