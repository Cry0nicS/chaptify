import {createReadStream} from "node:fs";
import {basename} from "node:path";
import {browserDownloadRequestSchema} from "../../../../shared/utils/schemas";
import {createBackendContext} from "../../../utils/backend/context";
import {hashBrowserJobAccessToken} from "../../../utils/backend/ids";
import {ensurePathInside} from "../../../utils/backend/paths";

export default defineEventHandler(async (event) => {
    const {config, jobs} = await createBackendContext();
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
