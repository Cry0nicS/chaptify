import {createReadStream} from "node:fs";
import {basename} from "node:path";
import {browserDownloadRequestSchema} from "../../../../shared/utils/schemas";
import {createBackendContext} from "../../../utils/backend/context";
import {hashBrowserJobAccessToken} from "../../../utils/backend/ids";
import {ensurePathInside} from "../../../utils/backend/paths";
import {checkDownloadRateLimit, getClientIp} from "../../../utils/backend/rate-limits";

/**
 * POST /api/jobs/:jobId/download streams a ready ZIP to the original browser session.
 *
 * The body must include the browser job-access token returned by `POST /api/jobs`. The token is
 * hashed before lookup and must match the public job ID, ready state, and unexpired retention
 * window; it is not interchangeable with the emailed download token.
 */
export default defineEventHandler(async (event) => {
    const {config, jobs} = await createBackendContext();
    if (!checkDownloadRateLimit(getClientIp(event), config.downloadRateLimit, 60 * 1000)) {
        throw createError({statusCode: 429, statusMessage: "Too many download requests"});
    }

    const jobId = getRouterParam(event, "job-id") || "";
    const parsedBody = browserDownloadRequestSchema.safeParse(await readBody(event));

    if (!parsedBody.success) {
        throw createError({
            statusCode: 400,
            statusMessage: "Invalid browser download request",
            data: {
                error: {
                    code: "INVALID_BROWSER_ACCESS_TOKEN",
                    message: "The browser download credential is invalid."
                }
            }
        });
    }

    const body = parsedBody.data;

    const job = jobs.findReadyByBrowserAccess(
        jobId,
        hashBrowserJobAccessToken(body.jobAccessToken),
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
