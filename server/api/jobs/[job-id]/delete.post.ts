import {browserDownloadRequestSchema} from "../../../../shared/utils/schemas";
import {createBackendContext} from "../../../utils/backend/context";
import {hashBrowserJobAccessToken} from "../../../utils/backend/ids";
import {checkDownloadRateLimit, getClientIp} from "../../../utils/backend/rate-limits";
import {cleanupJobFiles} from "../../../utils/backend/storage";

/**
 * Total time allowed to receive the small JSON body. The server-wide `requestTimeout` is disabled
 * for large uploads, so this route bounds its own body phase against a slow-drip client.
 */
const BODY_READ_TIMEOUT_MS = 10_000;

/**
 * POST /api/jobs/:jobId/delete purges a ready job's artifact immediately, on the user's request.
 *
 * Authenticated by the same browser job-access token used to create a download grant, so only the
 * uploading session can delete. It forces the job to `expired` (revoking the emailed link and any
 * browser grants), removes the files from disk, and releases the storage reservation — the same end
 * state as the 12h auto-expiry, triggered on demand. Job-type-agnostic: it serves both split and
 * convert jobs. Only ready jobs are deletable, so a repeat call after deletion is a 404.
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
        throw createError({statusCode: 429, statusMessage: "Too many requests"});
    }

    const jobId = getRouterParam(event, "job-id") || "";
    const request = event.node.req;
    const bodyTimer = setTimeout(
        () => request.destroy(new Error("Delete request body timed out")),
        BODY_READ_TIMEOUT_MS
    );
    let rawBody: unknown;
    try {
        rawBody = await readBody(event);
    } catch {
        throw createError({
            statusCode: 400,
            statusMessage: "Invalid delete request",
            data: {
                error: {
                    code: "INVALID_BROWSER_ACCESS_TOKEN",
                    message: "The browser credential is invalid."
                }
            }
        });
    } finally {
        clearTimeout(bodyTimer);
    }

    const parsedBody = browserDownloadRequestSchema.safeParse(rawBody);
    if (!parsedBody.success) {
        throw createError({
            statusCode: 400,
            statusMessage: "Invalid delete request",
            data: {
                error: {
                    code: "INVALID_BROWSER_ACCESS_TOKEN",
                    message: "The browser credential is invalid."
                }
            }
        });
    }

    const job = jobs.findReadyByBrowserAccess(
        jobId,
        hashBrowserJobAccessToken(parsedBody.data.jobAccessToken),
        new Date().toISOString()
    );
    if (!job) {
        throw createError({statusCode: 404, statusMessage: "Not found"});
    }

    const now = new Date().toISOString();
    jobs.markExpired(job.internalId, now);
    await cleanupJobFiles(config.storageRoot, job.internalId);
    jobs.releaseStorageReservation(job.internalId, now);

    return {status: "deleted"};
});
