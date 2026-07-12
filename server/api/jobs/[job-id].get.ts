import {jobStatusResponseSchema} from "../../../shared/utils/schemas";
import {createBackendContext} from "../../utils/backend/context";
import {toPublicJobStatus} from "../../utils/backend/database";

/**
 * GET /api/jobs/:jobId returns safe public status for a known public job ID.
 *
 * The response is schema-validated and intentionally excludes submitted email addresses, internal
 * job IDs, filesystem paths, download tokens, token hashes, and provider diagnostics.
 */
export default defineEventHandler(async (event) => {
    const {jobs} = await createBackendContext();
    const jobId = getRouterParam(event, "job-id") || "";
    const job = jobs.findByPublicId(jobId);

    if (!job) {
        throw createError({statusCode: 404, statusMessage: "Job not found"});
    }

    return jobStatusResponseSchema.parse(toPublicJobStatus(job));
});
