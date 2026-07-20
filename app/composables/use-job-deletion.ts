import {ref} from "vue";
import {jobDeleteResponseSchema} from "#shared/utils/schemas";
import {toFrontendApiError} from "../utils/api-errors";

/**
 * Shared "Delete now" action for a ready job, used by both the split and convert flows.
 *
 * It authenticates with the session-scoped browser job-access token (the same credential used to
 * create a download grant) and asks the server to purge the file and revoke its links immediately,
 * rather than waiting for the retention window to expire.
 */
export const useJobDeletion = () => {
    const isDeleting = ref(false);
    const deleted = ref(false);
    const deleteError = ref<string | null>(null);

    const runDeletion = async (jobId: string, jobAccessToken: string): Promise<boolean> => {
        if (!import.meta.client || isDeleting.value || deleted.value) {
            return false;
        }

        isDeleting.value = true;
        deleteError.value = null;

        try {
            const response = await $fetch<unknown>(
                `/api/jobs/${encodeURIComponent(jobId)}/delete`,
                {
                    method: "POST",
                    body: {jobAccessToken}
                }
            );
            jobDeleteResponseSchema.parse(response);
            deleted.value = true;

            return true;
        } catch (error) {
            deleteError.value = toFrontendApiError(
                error,
                "The file could not be deleted."
            ).guidance;

            return false;
        } finally {
            isDeleting.value = false;
        }
    };

    const resetDeletion = () => {
        isDeleting.value = false;
        deleted.value = false;
        deleteError.value = null;
    };

    return {isDeleting, deleted, deleteError, runDeletion, resetDeletion};
};
