import {createReadStream} from "node:fs";
import {stat} from "node:fs/promises";
import {createBackendContext} from "../../utils/backend/context";
import {describeJobDownload} from "../../utils/backend/download";
import {parseSignedDownloadToken, verifySignedDownloadToken} from "../../utils/backend/ids";
import {ensurePathInside} from "../../utils/backend/paths";
import {checkDownloadRateLimit, getClientIp} from "../../utils/backend/rate-limits";

/**
 * GET /api/download/:token streams the artifact referenced by a Mailgun completion email (a ZIP for
 * split jobs, a single audio file for convert jobs).
 *
 * The emailed link always carries an HMAC-signed token; it is parsed, matched to a ready, unexpired
 * job by its public ID, and its signature verified against the job's internal ID and expiry before
 * the stored artifact path is rechecked against the private storage root and streamed.
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
        !job?.outputPath ||
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

    const artifactPath = ensurePathInside(config.storageRoot, job.outputPath);

    try {
        await stat(artifactPath);
    } catch {
        throw createError({statusCode: 404, statusMessage: "Not found"});
    }

    const {filename, contentType} = describeJobDownload(job);
    setHeader(event, "Content-Type", contentType);
    setHeader(event, "Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);

    return sendStream(event, createReadStream(artifactPath));
});
