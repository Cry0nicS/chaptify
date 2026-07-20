import type {JobStatusResponse, OutputFormat, UploadJobResponse} from "#shared/utils/types";
import type {FrontendApiError} from "../utils/api-errors";
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {browserDownloadGrantResponseSchema} from "#shared/utils/schemas";
import {toFrontendApiError} from "../utils/api-errors";
import {maskEmailAddress} from "../utils/email";
import {getAudiobookExtension} from "../utils/file-validation";
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
 * Owns the upload → transcode → download state machine for the standalone converter page.
 *
 * Structurally the same as `useJobWorkflow` (the split flow) — it composes `useJobUpload` and
 * `useJobStatus` and drives the same `workflow` states — but it posts to the convert endpoint,
 * targets a constrained output format (the other of mp3/m4b) instead of a split toggle, and has no
 * chapter concerns.
 */
export const useConversionWorkflow = () => {
    const selectedFile = ref<File | null>(null);
    const email = ref("");
    const outputFormat = ref<OutputFormat>("m4b");
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

    const {
        abortUpload,
        isUploading,
        progress: uploadProgress,
        uploadJob
    } = useJobUpload({endpoint: "/api/convert"});
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
    const {isDeleting, deleted, deleteError, runDeletion, resetDeletion} = useJobDeletion();

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
    const canDelete = computed(() => canBrowserDownload.value && !deleted.value);

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
        // Default the target to the other format; converting to the same format is excluded.
        outputFormat.value = getAudiobookExtension(file.name) === "mp3" ? "m4b" : "mp3";
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
         * Uses the session-scoped job-access token to mint a one-time grant, exactly like the split
         * flow, so the emailed link credential never enters frontend state.
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

    const deleteReadyJob = async () => {
        if (workflow.value.status !== "ready" || !activeJobAccessToken.value) {
            return;
        }

        const removed = await runDeletion(workflow.value.job.jobId, activeJobAccessToken.value);
        if (removed) {
            stopPolling();
        }
    };

    const submitUpload = async () => {
        if (!selectedFile.value || isUploading.value) {
            return;
        }

        pageError.value = null;
        submittedEmail.value = email.value.trim();
        workflow.value = {status: "uploading"};

        const result = await uploadJob({
            file: selectedFile.value,
            email: email.value,
            outputFormat: outputFormat.value
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
        outputFormat.value = "m4b";
        submittedEmail.value = null;
        pageError.value = null;
        browserDownloadError.value = null;
        visibleProgress.value = 0;
        resetDeletion();
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
        canDelete,
        isDeleting,
        deleted,
        deleteError,
        onFileSelected,
        onFileRemoved,
        downloadReadyJob,
        deleteReadyJob,
        submitUpload,
        startOver
    };
};
