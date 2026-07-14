import {createReadStream} from "node:fs";
import {basename} from "node:path";
import {createBackendContext} from "../../utils/backend/context";
import {
    hashDownloadToken,
    parseSignedDownloadToken,
    verifySignedDownloadToken
} from "../../utils/backend/ids";
import {ensurePathInside} from "../../utils/backend/paths";
import {checkDownloadRateLimit, getClientIp} from "../../utils/backend/rate-limits";

/**
 * GET /api/download/:token streams the ZIP referenced by a Mailgun completion email.
 *
 * The raw URL token is treated as a bearer secret and immediately hashed for lookup. Only ready,
 * unexpired jobs resolve, and the stored ZIP path is rechecked against the private storage root
 * before streaming.
 */
export default defineEventHandler(async (event) => {
    const {config, jobs} = await createBackendContext();
    if (!checkDownloadRateLimit(getClientIp(event), config.downloadRateLimit, 60 * 1000)) {
        throw createError({statusCode: 429, statusMessage: "Too many download requests"});
    }

    const token = getRouterParam(event, "token") || "";

    if (!token) {
        throw createError({statusCode: 404, statusMessage: "Not found"});
    }

    const now = new Date().toISOString();
    const signed = parseSignedDownloadToken(token);
    const signedJob = signed ? jobs.findReadyByPublicId(signed.publicJobId, now) : null;
    const job =
        signedJob &&
        config.downloadSigningSecret &&
        signedJob.expiresAt &&
        verifySignedDownloadToken({
            token,
            internalId: signedJob.internalId,
            expiresAt: signedJob.expiresAt,
            signingSecret: config.downloadSigningSecret
        })
            ? signedJob
            : jobs.findReadyByTokenHash(hashDownloadToken(token), now);

    if (!job?.zipPath) {
        throw createError({statusCode: 404, statusMessage: "Not found"});
    }

    const zipPath = ensurePathInside(config.storageRoot, job.zipPath);
    setHeader(event, "Content-Type", "application/zip");
    setHeader(
        event,
        "Content-Disposition",
        `attachment; filename="${basename(zipPath).replace(/"/g, "")}"`
    );

    return sendStream(event, createReadStream(zipPath));
});
