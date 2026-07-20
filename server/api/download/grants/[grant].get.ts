import {createReadStream} from "node:fs";
import {stat} from "node:fs/promises";
import {createBackendContext} from "../../../utils/backend/context";
import {describeJobDownload} from "../../../utils/backend/download";
import {hashBrowserDownloadGrantToken} from "../../../utils/backend/ids";
import {ensurePathInside} from "../../../utils/backend/paths";
import {checkDownloadRateLimit, getClientIp} from "../../../utils/backend/rate-limits";

/**
 * GET /api/download/grants/:grant streams a ready job's artifact authorized by a short-lived browser
 * grant (a ZIP for split jobs, a single audio file for convert jobs).
 *
 * The uploading browser obtains this grant with its session-only job access token. Failed grant
 * creation stays on the app page; this route is only navigated to after authorization succeeds.
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

    const grant = getRouterParam(event, "grant") || "";
    if (!grant) {
        throw createError({statusCode: 404, statusMessage: "Not found"});
    }

    const job = jobs.consumeBrowserDownloadGrant(
        hashBrowserDownloadGrantToken(grant),
        new Date().toISOString()
    );

    if (!job?.outputPath) {
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
