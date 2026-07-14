import {browserDownloadRequestSchema} from "../../../../shared/utils/schemas";
import {createBackendContext} from "../../../utils/backend/context";
import {
    createBrowserDownloadGrantToken,
    hashBrowserDownloadGrantToken,
    hashBrowserJobAccessToken
} from "../../../utils/backend/ids";
import {checkDownloadRateLimit, getClientIp} from "../../../utils/backend/rate-limits";

/**
 * POST /api/jobs/:jobId/download creates a short-lived native download grant.
 *
 * The body must include the browser job-access token returned by `POST /api/jobs`. The token is
 * hashed before lookup and must match the public job ID, ready state, and unexpired retention
 * window; it is not interchangeable with the emailed download token or the one-use grant.
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

    if (!job?.zipPath || !job.expiresAt) {
        throw createError({statusCode: 404, statusMessage: "Not found"});
    }

    const now = new Date();
    const jobExpiryMs = new Date(job.expiresAt).getTime();
    const grantExpiryMs = Math.min(
        jobExpiryMs,
        now.getTime() + config.browserDownloadGrantLifetimeSeconds * 1000
    );
    if (!Number.isFinite(jobExpiryMs) || grantExpiryMs <= now.getTime()) {
        throw createError({statusCode: 404, statusMessage: "Not found"});
    }

    const token = createBrowserDownloadGrantToken();
    jobs.createBrowserDownloadGrant({
        publicJobId: job.publicJobId,
        internalId: job.internalId,
        tokenHash: hashBrowserDownloadGrantToken(token),
        createdAt: now.toISOString(),
        expiresAt: new Date(grantExpiryMs).toISOString()
    });

    return {
        downloadUrl: `/api/download/grants/${encodeURIComponent(token)}`
    };
});
