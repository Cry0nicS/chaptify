<script setup lang="ts">
import {useConversionWorkflow} from "../composables/use-conversion-workflow";

definePageMeta({
    layout: "default"
});

useSeoMeta({
    title: "MP3 to M4B Converter — and M4B to MP3",
    description:
        "Free online converter for audiobooks between MP3 and M4B. Keeps chapters, cover art, and metadata. Upload one file and get the converted download by email."
});

const {
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
} = useConversionWorkflow();
</script>

<template>
    <div class="mx-auto max-w-3xl py-10 sm:py-16">
        <section class="mb-10 space-y-5">
            <p class="text-primary font-mono text-xs tracking-[0.25em] uppercase">
                MP3 ⇄ M4B · Keeps chapters & cover art
            </p>
            <h1
                class="font-display text-highlighted text-4xl font-bold tracking-tight text-balance sm:text-6xl">
                Convert audiobooks between MP3 and M4B.
            </h1>
            <p class="text-muted max-w-2xl text-base sm:text-lg">
                Upload one audiobook and get it back in the other format — chapters, cover art, and
                metadata preserved. The download link is emailed and expires after 12 hours.
            </p>
        </section>

        <div class="space-y-6">
            <UCard>
                <template #header>
                    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h2 class="text-highlighted text-lg font-semibold">
                                Convert your audiobook
                            </h2>
                            <p class="text-muted text-sm">
                                MP3 to M4B or M4B to MP3. Works for songs and clips too.
                            </p>
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
                    class="text-muted text-sm">
                    <p class="mt-3">Checking your active job...</p>
                </div>

                <ConversionUploadForm
                    v-else-if="showUploadForm"
                    v-model:email="email"
                    v-model:output-format="outputFormat"
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
                            Your file is uploaded for temporary processing and is not stored
                            permanently. The converted file and download link expire after 12 hours,
                            or you can delete it yourself once it is ready.
                        </p>
                        <p>Only upload audio that you own or are authorized to convert.</p>
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

            <UAlert
                v-if="deleteError"
                color="warning"
                variant="soft"
                icon="i-lucide-circle-alert"
                title="Could not delete the file"
                :description="deleteError" />

            <JobResult
                v-if="terminalJob"
                :job="terminalJob"
                kind="convert"
                :can-browser-download="canBrowserDownload"
                :browser-download-error="browserDownloadError"
                :is-browser-download-starting="isBrowserDownloadStarting"
                :can-delete="canDelete"
                :is-deleting="isDeleting"
                :deleted="deleted"
                @download="downloadReadyJob"
                @delete="deleteReadyJob"
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

        <section
            class="border-default mt-16 border-t pt-10"
            aria-labelledby="convert-how">
            <h2
                id="convert-how"
                class="font-display text-highlighted text-2xl font-bold tracking-tight">
                How it works
            </h2>
            <div class="mt-6 grid gap-8 sm:grid-cols-3">
                <div class="space-y-2">
                    <p class="text-primary font-mono text-xs tracking-widest">01 · UPLOAD</p>
                    <h3 class="text-highlighted font-semibold">One file, one email</h3>
                    <p class="text-muted text-sm">
                        Drop in an MP3 or M4B you own and pick the target format.
                    </p>
                </div>
                <div class="space-y-2">
                    <p class="text-primary font-mono text-xs tracking-widest">02 · CONVERT</p>
                    <h3 class="text-highlighted font-semibold">Faithful re-encode</h3>
                    <p class="text-muted text-sm">
                        Chaptify transcodes the audio while preserving chapters, cover art, and
                        tags.
                    </p>
                </div>
                <div class="space-y-2">
                    <p class="text-primary font-mono text-xs tracking-widest">03 · DOWNLOAD</p>
                    <h3 class="text-highlighted font-semibold">Grab it, then delete</h3>
                    <p class="text-muted text-sm">
                        Download the converted file here or from the email, and delete it when done.
                    </p>
                </div>
            </div>
        </section>
    </div>
</template>
