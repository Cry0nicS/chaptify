import type {JobStatusResponse} from "#shared/utils/types";
import {onScopeDispose, ref} from "vue";
import {jobStatusResponseSchema} from "#shared/utils/schemas";

interface UseJobStatusOptions {
    intervalMs?: number;
    maxTransientFailures?: number;
    fetchJobStatus?: (jobId: string, signal: AbortSignal) => Promise<unknown>;
    storage?: Storage;
}

const ACTIVE_JOB_STORAGE_KEY = "chaptify.activeJobId";

const isTerminalStatus = (status: JobStatusResponse["status"]): boolean =>
    status === "ready" || status === "failed" || status === "expired";

export const useJobStatus = (options: UseJobStatusOptions = {}) => {
    const job = ref<JobStatusResponse | null>(null);
    const transientError = ref<string | null>(null);
    const isPolling = ref(false);
    const isRecovering = ref(false);
    const failures = ref(0);
    const activeJobId = ref<string | null>(null);

    const intervalMs = options.intervalMs ?? 2000;
    const maxTransientFailures = options.maxTransientFailures ?? 5;
    const storage = options.storage || (import.meta.client ? window.sessionStorage : undefined);
    const fetchJobStatus =
        options.fetchJobStatus ||
        ((jobId: string, signal: AbortSignal) =>
            $fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {signal}));

    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const clearTimer = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };

    const persistActiveJob = (jobId: string) => {
        activeJobId.value = jobId;
        storage?.setItem(ACTIVE_JOB_STORAGE_KEY, jobId);
    };

    const clearActiveJob = () => {
        activeJobId.value = null;
        storage?.removeItem(ACTIVE_JOB_STORAGE_KEY);
    };

    const stopPolling = () => {
        clearTimer();
        controller?.abort();
        controller = null;
        isPolling.value = false;
    };

    const fetchOnce = async (jobId: string): Promise<JobStatusResponse | null> => {
        controller?.abort();
        controller = new AbortController();

        try {
            const response = await fetchJobStatus(jobId, controller.signal);
            const parsed = jobStatusResponseSchema.parse(response);
            job.value = parsed;
            transientError.value = null;
            failures.value = 0;

            return parsed;
        } catch (error) {
            if (controller.signal.aborted) {
                return null;
            }

            failures.value += 1;
            transientError.value =
                failures.value >= maxTransientFailures
                    ? "We still cannot refresh the status. Processing may continue in the background."
                    : "Status updates are temporarily unavailable. Retrying...";

            const statusCode =
                typeof error === "object" && error !== null && "statusCode" in error
                    ? Number((error as {statusCode?: unknown}).statusCode)
                    : 0;

            if (statusCode === 404) {
                clearActiveJob();
                stopPolling();
            }

            return null;
        }
    };

    const poll = async (jobId: string) => {
        if (!isPolling.value) {
            return;
        }

        const nextJob = await fetchOnce(jobId);

        if (nextJob && isTerminalStatus(nextJob.status)) {
            stopPolling();
            return;
        }

        if (isPolling.value) {
            clearTimer();
            timer = setTimeout(() => {
                void poll(jobId);
            }, intervalMs);
        }
    };

    const startPolling = (jobId: string) => {
        stopPolling();
        persistActiveJob(jobId);
        isPolling.value = true;
        void poll(jobId);
    };

    const recoverActiveJob = async () => {
        const storedJobId = storage?.getItem(ACTIVE_JOB_STORAGE_KEY);

        if (!storedJobId) {
            return null;
        }

        isRecovering.value = true;
        persistActiveJob(storedJobId);
        const recovered = await fetchOnce(storedJobId);
        isRecovering.value = false;

        if (recovered && !isTerminalStatus(recovered.status)) {
            startPolling(storedJobId);
        }

        return recovered;
    };

    onScopeDispose(stopPolling);

    return {
        activeJobId,
        clearActiveJob,
        isPolling,
        isRecovering,
        job,
        recoverActiveJob,
        startPolling,
        stopPolling,
        transientError
    };
};

export {ACTIVE_JOB_STORAGE_KEY};
