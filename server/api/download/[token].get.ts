import {createReadStream} from "node:fs";
import {stat} from "node:fs/promises";
import {basename} from "node:path";
import {createBackendContext} from "../../utils/backend/context";
import {parseSignedDownloadToken, verifySignedDownloadToken} from "../../utils/backend/ids";
import {ensurePathInside} from "../../utils/backend/paths";
import {checkDownloadRateLimit, getClientIp} from "../../utils/backend/rate-limits";

/**
 * GET /api/download/:token streams the ZIP referenced by a Mailgun completion email.
 *
 * The emailed link always carries an HMAC-signed token; it is parsed, matched to a ready, unexpired
 * job by its public ID, and its signature verified against the job's internal ID and expiry before
 * the stored ZIP path is rechecked against the private storage root and streamed.
 */
export default defineEventHandler(async (event) => {
    const {config, jobs} = await createBackendContext();
    if (
        !checkDownloadRateLimit(
            getClientIp(event, config.trustProxy),
            config.downloadRateLimit,
            60 * 1000
        )
    ) {
        throw createError({statusCode: 429, statusMessage: "Too many download requests"});
    }

    const token = getRouterParam(event, "token") || "";

    if (!token || !config.downloadSigningSecret) {
        throw createError({statusCode: 404, statusMessage: "Not found"});
    }

    const now = new Date().toISOString();
    const signed = parseSignedDownloadToken(token);
    const job = signed ? jobs.findReadyByPublicId(signed.publicJobId, now) : null;

    if (
        !job?.zipPath ||
        !job.expiresAt ||
        !verifySignedDownloadToken({
            token,
            internalId: job.internalId,
            expiresAt: job.expiresAt,
            signingSecret: config.downloadSigningSecret
        })
    ) {
        throw createError({statusCode: 404, statusMessage: "Not found"});
    }

    const zipPath = ensurePathInside(config.storageRoot, job.zipPath);

    try {
        await stat(zipPath);
    } catch {
        throw createError({statusCode: 404, statusMessage: "Not found"});
    }

    setHeader(event, "Content-Type", "application/zip");
    setHeader(
        event,
        "Content-Disposition",
        `attachment; filename="${basename(zipPath).replace(/"/g, "")}"`
    );

    return sendStream(event, createReadStream(zipPath));
});
