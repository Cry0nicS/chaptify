import type {JobStatusResponse, OutputFormat, UploadJobResponse} from "#shared/utils/types";
import type {FrontendApiError} from "../utils/api-errors";
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {browserDownloadGrantResponseSchema} from "#shared/utils/schemas";
import {toFrontendApiError} from "../utils/api-errors";
import {maskEmailAddress, validateEmailAddress} from "../utils/email";
import {getAudiobookExtension, validateAudiobookFile} from "../utils/file-validation";
import {formatFileSize} from "../utils/format-file-size";
import {displayProcessingProgress} from "../utils/progress";

type WorkflowState =
    | {status: "idle"}
    | {status: "selected"}
    | {status: "uploading"}
    | {status: "queued"; job: JobStatusResponse | null; submittedEmail: string | null}
    | {status: "processing"; job: JobStatusResponse; submittedEmail: string | null}
    | {status: "ready"; job: JobStatusResponse}
    | {status: "failed"; job: JobStatusResponse | null; error: FrontendApiError | null}
    | {status: "expired"; job: JobStatusResponse};

/**
 * Owns the audiobook upload → process → download state machine for the home page.
 *
 * Composes the low-level `useJobUpload` (progress-aware XHR upload) and `useJobStatus` (polling +
 * session recovery) composables into the single `workflow` state the page renders, and exposes the
 * handful of refs, derived values, and actions the template binds to. Extracted from the page so
 * the state machine is isolated from markup and independently testable.
 */
export const useJobWorkflow = () => {
    const selectedFile = ref<File | null>(null);
    const email = ref("");
    const outputFormat = ref<OutputFormat>("mp3");
    const splitWithoutChapters = ref(false);
    const workflow = ref<WorkflowState>({status: "idle"});
    const pageError = ref<FrontendApiError | null>(null);
    const submittedEmail = ref<string | null>(null);
    const visibleProgress = ref(0);
    const browserDownloadError = ref<string | null>(null);
    const isBrowserDownloadStarting = ref(false);
    const beforeUnload = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = "";
    };

    const {abortUpload, isUploading, progress: uploadProgress, uploadJob} = useJobUpload();
    const {
        activeJobAccessToken,
        activeJobId,
        clearActiveJob,
        isRecovering,
        job,
        recoverActiveJob,
        startPolling,
        stopPolling,
        transientError
    } = useJobStatus();

    const fileValidation = computed(() => validateAudiobookFile(selectedFile.value));
    const emailValidation = computed(() =>
        email.value.trim() ? validateEmailAddress(email.value) : "Enter a valid email address."
    );
    const canSubmit = computed(
        () =>
            fileValidation.value.valid &&
            !emailValidation.value &&
            workflow.value.status !== "uploading"
    );
    const selectedFileDetails = computed(() => {
        if (!selectedFile.value) {
            return null;
        }

        return `${selectedFile.value.name}, ${formatFileSize(selectedFile.value.size)}`;
    });
    const maskedSubmittedEmail = computed(() =>
        submittedEmail.value ? maskEmailAddress(submittedEmail.value) : null
    );
    const showUploadForm = computed(
        () =>
            workflow.value.status === "idle" ||
            workflow.value.status === "selected" ||
            workflow.value.status === "uploading" ||
            (workflow.value.status === "failed" && !workflow.value.job)
    );
    const terminalJob = computed(() =>
        workflow.value.status === "ready" ||
        (workflow.value.status === "failed" && workflow.value.job) ||
        workflow.value.status === "expired"
            ? workflow.value.job
            : null
    );
    const canBrowserDownload = computed(
        () => workflow.value.status === "ready" && Boolean(activeJobAccessToken.value)
    );

    const terminalStatusToWorkflow = (nextJob: JobStatusResponse): WorkflowState => {
        if (nextJob.status === "ready") {
            return {status: "ready", job: nextJob};
        }

        if (nextJob.status === "failed") {
            return {
                status: "failed",
                job: nextJob,
                error: nextJob.error
                    ? {
                          code: nextJob.error.code,
                          message: nextJob.error.message,
                          guidance: toFrontendApiError({error: nextJob.error}).guidance
                      }
                    : null
            };
        }

        return {status: "expired", job: nextJob};
    };

    const syncWorkflowFromJob = (nextJob: JobStatusResponse | null) => {
        if (!nextJob) {
            return;
        }

        visibleProgress.value = displayProcessingProgress(
            nextJob.status,
            visibleProgress.value,
            nextJob.progress
        );

        if (nextJob.status === "queued") {
            workflow.value = {
                status: "queued",
                job: nextJob,
                submittedEmail: submittedEmail.value
            };
            return;
        }

        if (nextJob.status === "processing") {
            workflow.value = {
                status: "processing",
                job: nextJob,
                submittedEmail: submittedEmail.value
            };
            return;
        }

        workflow.value = terminalStatusToWorkflow(nextJob);
    };

    watch(job, syncWorkflowFromJob);

    watch(isUploading, (uploading) => {
        if (!import.meta.client) {
            return;
        }

        if (uploading) {
            window.addEventListener("beforeunload", beforeUnload);
        } else {
            window.removeEventListener("beforeunload", beforeUnload);
        }
    });

    const onFileSelected = (file: File) => {
        selectedFile.value = file;
        pageError.value = null;
        // Default the output to the uploaded format (stream copy); the user can switch to convert.
        outputFormat.value = getAudiobookExtension(file.name) ?? "mp3";
        workflow.value = {status: "selected"};
    };

    const onFileRemoved = () => {
        selectedFile.value = null;
        pageError.value = null;
        workflow.value = {status: "idle"};
    };

    const handleCreatedJob = (created: UploadJobResponse) => {
        visibleProgress.value = 0;
        const queuedJob: JobStatusResponse = {
            jobId: created.jobId,
            status: "queued",
            progress: 0,
            currentChapter: null,
            totalChapters: null,
            createdAt: created.createdAt,
            completedAt: null,
            expiresAt: null,
            emailStatus: "pending",
            error: null
        };
        workflow.value = {
            status: "queued",
            job: queuedJob,
            submittedEmail: submittedEmail.value
        };
        startPolling(created.jobId, created.jobAccessToken);
    };

    const downloadReadyJob = async () => {
        if (
            workflow.value.status !== "ready" ||
            !activeJobAccessToken.value ||
            !import.meta.client
        ) {
            return;
        }

        /*
         * The browser download path uses the session-scoped job-access token, not the emailed ZIP
         * token. This lets users recover a ready upload in the same tab session without exposing the
         * Mailgun link credential to frontend state.
         */
        browserDownloadError.value = null;
        isBrowserDownloadStarting.value = true;

        try {
            const response = await $fetch<unknown>(
                `/api/jobs/${encodeURIComponent(workflow.value.job.jobId)}/download`,
                {
                    method: "POST",
                    body: {
                        jobAccessToken: activeJobAccessToken.value
                    }
                }
            );
            const parsed = browserDownloadGrantResponseSchema.parse(response);

            window.location.assign(parsed.downloadUrl);
        } catch (error) {
            const parsedError = toFrontendApiError(
                error,
                "The direct download could not be started."
            );
            browserDownloadError.value =
                parsedError.guidance ||
                "The emailed link may still work until expiration if it was delivered.";
        } finally {
            isBrowserDownloadStarting.value = false;
        }
    };

    const submitUpload = async () => {
        if (!selectedFile.value || !canSubmit.value || isUploading.value) {
            return;
        }

        pageError.value = null;
        submittedEmail.value = email.value.trim();
        workflow.value = {status: "uploading"};

        const result = await uploadJob({
            file: selectedFile.value,
            email: email.value,
            outputFormat: outputFormat.value,
            splitWithoutChapters: splitWithoutChapters.value
        });

        if (result.ok) {
            handleCreatedJob(result.data);
            return;
        }

        pageError.value = result.failure.error;
        workflow.value = {
            status: "failed",
            job: null,
            error: result.failure.error
        };
    };

    const startOver = () => {
        if (isUploading.value) {
            abortUpload();
        }

        stopPolling();
        clearActiveJob();
        selectedFile.value = null;
        email.value = "";
        outputFormat.value = "mp3";
        splitWithoutChapters.value = false;
        submittedEmail.value = null;
        pageError.value = null;
        browserDownloadError.value = null;
        visibleProgress.value = 0;
        workflow.value = {status: "idle"};
    };

    onMounted(async () => {
        const recovered = await recoverActiveJob();

        if (recovered) {
            syncWorkflowFromJob(recovered);
        }
    });

    onBeforeUnmount(() => {
        stopPolling();
        if (import.meta.client) {
            window.removeEventListener("beforeunload", beforeUnload);
        }
    });

    return {
        selectedFile,
        email,
        outputFormat,
        splitWithoutChapters,
        workflow,
        pageError,
        visibleProgress,
        browserDownloadError,
        isBrowserDownloadStarting,
        uploadProgress,
        activeJobId,
        isRecovering,
        transientError,
        selectedFileDetails,
        maskedSubmittedEmail,
        showUploadForm,
        terminalJob,
        canBrowserDownload,
        onFileSelected,
        onFileRemoved,
        downloadReadyJob,
        submitUpload,
        startOver
    };
};
