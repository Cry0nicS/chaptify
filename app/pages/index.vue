<script setup lang="ts">
import type {JobStatusResponse, UploadJobResponse} from "#shared/utils/types";
import type {FrontendApiError} from "../utils/api-errors";
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {toFrontendApiError} from "../utils/api-errors";
import {maskEmailAddress, validateEmailAddress} from "../utils/email";
import {validateAudiobookFile} from "../utils/file-validation";
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

const selectedFile = ref<File | null>(null);
const email = ref("");
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

definePageMeta({
    layout: "default"
});

useSeoMeta({
    title: "Chaptify | Split audiobooks into chapters",
    description:
        "Upload an M4B or MP3 audiobook with embedded chapter metadata and receive chapter files by email."
});

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

const parseDownloadFilename = (contentDisposition: string | null): string => {
    const match = contentDisposition?.match(/filename="([^"]+)"/);

    return match?.[1] || "chaptify-chapters.zip";
};

const downloadReadyJob = async () => {
    if (workflow.value.status !== "ready" || !activeJobAccessToken.value || !import.meta.client) {
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
        const response = await fetch(
            `/api/jobs/${encodeURIComponent(workflow.value.job.jobId)}/download`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({jobAccessToken: activeJobAccessToken.value})
            }
        );

        if (!response.ok) {
            throw new Error("The direct download is no longer available.");
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = parseDownloadFilename(response.headers.get("Content-Disposition"));
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    } catch {
        browserDownloadError.value =
            "The direct download could not be started. The emailed link may still work until expiration.";
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
        email: email.value
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
</script>

<template>
    <div class="mx-auto max-w-3xl py-8 sm:py-12">
        <section class="mb-8 space-y-4">
            <UBadge
                color="primary"
                variant="soft"
                icon="i-lucide-headphones">
                M4B and MP3
            </UBadge>
            <div class="space-y-3">
                <h1 class="text-highlighted text-3xl font-semibold tracking-normal sm:text-4xl">
                    Split your audiobook into chapters
                </h1>
                <p class="text-muted max-w-2xl text-base sm:text-lg">
                    Upload one M4B or MP3 audiobook. Chaptify will split it into individual chapter
                    files, package them as a ZIP, and email you a temporary download link.
                </p>
            </div>
        </section>

        <div class="space-y-6">
            <UCard>
                <template #header>
                    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h2 class="text-highlighted text-lg font-semibold">
                                Process audiobook
                            </h2>
                            <p class="text-muted text-sm">Embedded chapter metadata is required.</p>
                        </div>
                        <UBadge
                            v-if="activeJobId"
                            color="neutral"
                            variant="soft">
                            Active job restored
                        </UBadge>
                    </div>
                </template>

                <div
                    v-if="isRecovering"
                    class="py-8"
                    aria-live="polite">
                    <UProgress animation="carousel" />
                    <p class="text-muted mt-3 text-sm">Checking your active job...</p>
                </div>

                <AudiobookUploadForm
                    v-else-if="showUploadForm"
                    v-model:email="email"
                    :file="selectedFile"
                    :disabled="workflow.status === 'uploading'"
                    :is-uploading="workflow.status === 'uploading'"
                    :upload-progress-label="uploadProgress.label"
                    :upload-progress-percent="uploadProgress.percent"
                    @file-selected="onFileSelected"
                    @file-removed="onFileRemoved"
                    @submit="submitUpload" />

                <div
                    v-if="selectedFileDetails && workflow.status === 'uploading'"
                    class="sr-only"
                    aria-live="polite">
                    Uploading {{ selectedFileDetails }}
                </div>

                <template #footer>
                    <div class="text-muted space-y-2 text-sm">
                        <p>
                            Your audiobook is uploaded for temporary processing and is not stored
                            permanently. The generated ZIP and download link expire after 12 hours.
                        </p>
                        <p>Only upload audiobooks that you own or are authorized to process.</p>
                    </div>
                </template>
            </UCard>

            <UAlert
                v-if="pageError"
                color="error"
                variant="soft"
                icon="i-lucide-circle-alert"
                :title="pageError.message"
                :description="pageError.guidance"
                role="alert" />

            <section
                v-if="workflow.status === 'queued'"
                class="space-y-4">
                <JobProgress
                    v-if="workflow.job"
                    :job="workflow.job"
                    :previous-progress="visibleProgress"
                    :transient-error="transientError" />
                <UAlert
                    color="primary"
                    variant="soft"
                    icon="i-lucide-mail"
                    title="Email queued for completion"
                    :description="
                        maskedSubmittedEmail
                            ? `The download link will be sent to ${maskedSubmittedEmail}.`
                            : 'The download link will be sent by email.'
                    " />
            </section>

            <JobProgress
                v-if="workflow.status === 'processing'"
                :job="workflow.job"
                :previous-progress="visibleProgress"
                :transient-error="transientError" />

            <JobResult
                v-if="terminalJob"
                :job="terminalJob"
                :can-browser-download="canBrowserDownload"
                :browser-download-error="browserDownloadError"
                :is-browser-download-starting="isBrowserDownloadStarting"
                @download="downloadReadyJob"
                @start-over="startOver" />

            <div
                v-if="workflow.status === 'failed' && !workflow.job"
                class="flex justify-start">
                <UButton
                    type="button"
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-refresh-cw"
                    @click="startOver">
                    Start over
                </UButton>
            </div>
        </div>
    </div>
</template>
