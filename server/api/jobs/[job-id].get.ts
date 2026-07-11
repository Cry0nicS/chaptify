import {jobStatusResponseSchema} from "../../../shared/utils/schemas";
import {createBackendContext} from "../../utils/backend/context";
import {toPublicJobStatus} from "../../utils/backend/database";

export default defineEventHandler(async (event) => {
    const {jobs} = await createBackendContext();
    const jobId = getRouterParam(event, "job-id") || "";
    const job = jobs.findByPublicId(jobId);

    if (!job) {
        throw createError({statusCode: 404, statusMessage: "Job not found"});
    }

    return jobStatusResponseSchema.parse(toPublicJobStatus(job));
});
