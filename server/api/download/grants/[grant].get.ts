import {createReadStream} from "node:fs";
import {basename} from "node:path";
import {createBackendContext} from "../../../utils/backend/context";
import {hashBrowserDownloadGrantToken} from "../../../utils/backend/ids";
import {ensurePathInside} from "../../../utils/backend/paths";
import {checkDownloadRateLimit, getClientIp} from "../../../utils/backend/rate-limits";

/**
 * GET /api/download/grants/:grant streams a ZIP authorized by a short-lived browser grant.
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
