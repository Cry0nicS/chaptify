import {createReadStream} from "node:fs";
import {basename} from "node:path";
import {createBackendContext} from "../../utils/backend/context";
import {hashDownloadToken} from "../../utils/backend/ids";
import {ensurePathInside} from "../../utils/backend/paths";

/**
 * GET /api/download/:token streams the ZIP referenced by a Mailgun completion email.
 *
 * The raw URL token is treated as a bearer secret and immediately hashed for lookup. Only ready,
 * unexpired jobs resolve, and the stored ZIP path is rechecked against the private storage root
 * before streaming.
 */
export default defineEventHandler(async (event) => {
    const {config, jobs} = await createBackendContext();
    const token = getRouterParam(event, "token") || "";

    if (!token) {
        throw createError({statusCode: 404, statusMessage: "Not found"});
    }

    const job = jobs.findReadyByTokenHash(hashDownloadToken(token), new Date().toISOString());
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
