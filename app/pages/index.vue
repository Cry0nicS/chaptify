<script setup lang="ts">
import {useJobWorkflow} from "../composables/use-job-workflow";

definePageMeta({
    layout: "default"
});

useSeoMeta({
    title: "Chaptify | Split audiobooks into chapters",
    description:
        "Upload an M4B or MP3 audiobook with embedded chapter metadata and receive chapter files by email."
});

const {
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
} = useJobWorkflow();
</script>

<template>
    <div class="mx-auto max-w-3xl py-10 sm:py-16">
        <section class="mb-10 space-y-5">
            <p class="text-primary font-mono text-xs tracking-[0.25em] uppercase">
                M4B · MP3 · Embedded chapters
            </p>
            <h1
                class="font-display text-highlighted text-4xl font-bold tracking-tight text-balance sm:text-6xl">
                One audiobook in. Every chapter out.
            </h1>
            <p class="text-muted max-w-2xl text-base sm:text-lg">
                Chaptify splits a single audiobook into per-chapter files, zips them, and emails you
                a temporary download link. Built for watches and small players that choke on one big
                file.
            </p>
        </section>

        <ChapterWaveform class="mb-10" />

        <div class="space-y-6">
            <UCard>
                <template #header>
                    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h2 class="text-highlighted text-lg font-semibold">
                                Split your audiobook
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
                    v-model:output-format="outputFormat"
                    v-model:split-without-chapters="splitWithoutChapters"
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

        <section
            class="border-default mt-16 border-t pt-10"
            aria-labelledby="how-it-works">
            <h2
                id="how-it-works"
                class="font-display text-highlighted text-2xl font-bold tracking-tight">
                How it works
            </h2>
            <div class="mt-6 grid gap-8 sm:grid-cols-3">
                <div class="space-y-2">
                    <p class="text-primary font-mono text-xs tracking-widest">CH 01 · UPLOAD</p>
                    <h3 class="text-highlighted font-semibold">One file, one email</h3>
                    <p class="text-muted text-sm">
                        Drop in an M4B or MP3 you own, pick the output format, and leave an email
                        address for the download link.
                    </p>
                </div>
                <div class="space-y-2">
                    <p class="text-primary font-mono text-xs tracking-widest">CH 02 · SPLIT</p>
                    <h3 class="text-highlighted font-semibold">Cut at every chapter</h3>
                    <p class="text-muted text-sm">
                        Chaptify reads the chapter marks embedded in the file and cuts the audio at
                        each one — no guessing, no silence detection.
                    </p>
                </div>
                <div class="space-y-2">
                    <p class="text-primary font-mono text-xs tracking-widest">CH 03 · LISTEN</p>
                    <h3 class="text-highlighted font-semibold">Sync and go</h3>
                    <p class="text-muted text-sm">
                        You get a ZIP of chapter files by email. Sync them to your watch or player.
                        Link and files delete themselves after 12 hours.
                    </p>
                </div>
            </div>
            <div class="border-primary/25 bg-primary/5 mt-10 rounded-lg border p-6 sm:p-8">
                <p class="text-primary font-mono text-xs tracking-widest">CH 04 · YOUR TURN</p>
                <h3 class="font-display text-highlighted mt-2 text-xl font-bold tracking-tight">
                    Help write the next chapter
                </h3>
                <p class="text-muted mt-2 max-w-xl text-sm">
                    Chaptify improves through the people who use it. If a feature is missing or
                    something didn't split the way it should, a short message steers what gets built
                    next.
                </p>
                <UButton
                    class="mt-4"
                    to="/contact"
                    variant="soft"
                    icon="i-lucide-message-square-plus">
                    Suggest a feature or report a bug
                </UButton>
            </div>

            <p class="text-muted mt-8 text-sm">
                Built by a marathon runner whose watch refused to play one big file.
                <ULink
                    class="text-primary font-medium"
                    to="/about">
                    Read the story
                </ULink>
            </p>
        </section>
    </div>
</template>
