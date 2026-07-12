import type {JobStatusResponse} from "#shared/utils/types";
import {onScopeDispose, ref} from "vue";
import {jobStatusResponseSchema} from "#shared/utils/schemas";

interface UseJobStatusOptions {
    intervalMs?: number;
    maxTransientFailures?: number;
    fetchJobStatus?: (jobId: string, signal: AbortSignal) => Promise<unknown>;
    storage?: Storage;
}

interface ActiveJobCredentials {
    jobId: string;
    jobAccessToken: string;
}

const ACTIVE_JOB_STORAGE_KEY = "chaptify.activeJob";

const isPollingComplete = (job: JobStatusResponse): boolean =>
    job.status === "failed" ||
    job.status === "expired" ||
    (job.status === "ready" && job.emailStatus !== "pending");

/**
 * Polls public job status and restores the active browser-download credential.
 *
 * The composable persists only the public job ID and browser job-access token in session storage.
 * Timers and in-flight requests are aborted on scope disposal, and polling continues while a ready
 * ZIP is waiting on Mailgun so the UI can show the final email delivery state.
 */
export const useJobStatus = (options: UseJobStatusOptions = {}) => {
    const job = ref<JobStatusResponse | null>(null);
    const transientError = ref<string | null>(null);
    const isPolling = ref(false);
    const isRecovering = ref(false);
    const failures = ref(0);
    const activeJobId = ref<string | null>(null);
    const activeJobAccessToken = ref<string | null>(null);

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

    const readActiveJob = (): ActiveJobCredentials | null => {
        const stored = storage?.getItem(ACTIVE_JOB_STORAGE_KEY);

        if (!stored) {
            return null;
        }

        try {
            const parsed = JSON.parse(stored) as Partial<ActiveJobCredentials>;

            if (typeof parsed.jobId === "string" && typeof parsed.jobAccessToken === "string") {
                return {
                    jobId: parsed.jobId,
                    jobAccessToken: parsed.jobAccessToken
                };
            }
        } catch {
            return null;
        }

        return null;
    };

    const persistActiveJob = (credentials: ActiveJobCredentials) => {
        const {jobId, jobAccessToken} = credentials;
        activeJobId.value = jobId;
        activeJobAccessToken.value = jobAccessToken;
        storage?.setItem(ACTIVE_JOB_STORAGE_KEY, JSON.stringify(credentials));
    };

    const clearActiveJob = () => {
        activeJobId.value = null;
        activeJobAccessToken.value = null;
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

        if (nextJob && isPollingComplete(nextJob)) {
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

    const startPolling = (jobId: string, jobAccessToken?: string) => {
        stopPolling();
        const token = jobAccessToken ?? activeJobAccessToken.value;

        if (token) {
            persistActiveJob({jobId, jobAccessToken: token});
        } else {
            activeJobId.value = jobId;
        }

        isPolling.value = true;
        void poll(jobId);
    };

    const recoverActiveJob = async () => {
        const storedJob = readActiveJob();

        if (!storedJob) {
            clearActiveJob();
            return null;
        }

        isRecovering.value = true;
        persistActiveJob(storedJob);
        const recovered = await fetchOnce(storedJob.jobId);
        isRecovering.value = false;

        if (recovered && !isPollingComplete(recovered)) {
            startPolling(storedJob.jobId, storedJob.jobAccessToken);
        }

        return recovered;
    };

    onScopeDispose(stopPolling);

    return {
        activeJobAccessToken,
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
