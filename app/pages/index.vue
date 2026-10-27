<script setup lang="ts">
import {useJobWorkflow} from "../composables/use-job-workflow";

definePageMeta({
    layout: "default"
});

useSeo({
    title: "Split audiobooks into chapters",
    description:
        "Split an M4B or MP3 audiobook into per-chapter files by its embedded chapters and get them by email. Free, no signup — download links expire in 12 hours."
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
} = useJobWorkflow();

/*
 * The right column is one slot: the upload form until a job exists, then that job's progress and
 * result in its place. Sticky only applies to the form, because a terminal job's stack can be taller
 * than the viewport and must stay scrollable.
 */
const showJobPanel = computed(() => !isRecovering.value && !showUploadForm.value);

const layers = [
    {
        index: "01",
        title: "Reads the chapter table",
        body: "The marks are already in your file. Chaptify reads them with ffprobe and cuts exactly there — never guessed from silence, never invented.",
        data: "ffprobe · 300 marks max"
    },
    {
        index: "02",
        title: "Cuts and packs in order",
        body: "Every chapter becomes its own file, named so any player keeps the sequence, then archived into a single ZIP.",
        data: "MP3 or M4B · 1.6 GB in"
    },
    {
        index: "03",
        title: "Sends one link, then forgets",
        body: "The link arrives by email and works once you are ready for it. After twelve hours the archive and your upload are gone.",
        data: "TTL 12 h · no account"
    }
];
</script>

<template>
    <div class="pb-16">
        <section
            class="grid gap-10 pt-12 pb-10 lg:grid-cols-[minmax(0,1fr)_minmax(27rem,0.9fr)] lg:gap-14 lg:pt-16">
            <div class="min-w-0 lg:pt-2">
                <p class="micro-label text-secondary flex items-center gap-2">
                    <UIcon
                        name="i-lucide-watch"
                        class="size-4 shrink-0" />
                    Made for running watches and small players
                </p>
                <h1
                    class="font-display text-highlighted mt-4 max-w-[18ch] text-5xl leading-[0.95] font-bold text-balance sm:text-6xl lg:text-7xl">
                    One audiobook, split into every chapter it already has.
                </h1>

                <p class="text-toned mt-6 max-w-[52ch] text-base sm:text-lg">
                    Chaptify cuts your M4B or MP3 at its embedded chapter marks, packs the parts
                    into one archive, and emails a link that expires. No account, no library, no
                    copy kept.
                </p>

                <dl
                    class="border-default mt-8 grid grid-cols-2 gap-x-8 gap-y-5 border-t pt-6 sm:flex sm:flex-wrap sm:gap-x-10">
                    <div>
                        <dt class="micro-label">Accepts</dt>
                        <dd class="stat text-highlighted mt-1 text-3xl">M4B · MP3</dd>
                    </div>
                    <div>
                        <dt class="micro-label">Up to</dt>
                        <dd class="stat text-highlighted mt-1 text-3xl">1.6 GB · 30 h</dd>
                    </div>
                    <div>
                        <dt class="micro-label">Link expires</dt>
                        <dd class="stat text-highlighted mt-1 text-3xl">12 h</dd>
                    </div>
                    <div>
                        <dt class="micro-label">Cost</dt>
                        <dd class="stat text-secondary mt-1 text-3xl">Free</dd>
                    </div>
                </dl>
            </div>

            <!-- On small screens the form follows the headline directly; the example sits below it. -->
            <div
                class="lg:col-start-2 lg:row-span-2 lg:row-start-1"
                :class="showJobPanel ? 'lg:self-start' : 'lg:sticky lg:top-24 lg:self-start'">
                <div
                    v-if="!showJobPanel"
                    class="pane pane-front pane-settle pane-settle-2 p-5 sm:p-6">
                    <div class="mb-5 flex items-center justify-between gap-4">
                        <h2 class="text-highlighted text-lg font-semibold tracking-tight">
                            Split your audiobook
                        </h2>
                        <UBadge
                            v-if="activeJobId"
                            color="neutral"
                            variant="soft">
                            Job restored
                        </UBadge>
                    </div>

                    <div
                        v-if="isRecovering"
                        class="py-6"
                        aria-live="polite">
                        <UProgress animation="carousel" />
                        <p class="data-line mt-3">Checking your active job…</p>
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

                    <p class="border-muted text-muted mt-5 border-t pt-4 text-sm">
                        Your audiobook is processed, then deleted with its archive after 12 hours.
                        Only upload audiobooks you own or are authorised to process.
                    </p>
                </div>

                <div
                    v-else
                    class="flex flex-col gap-4">
                    <template v-if="workflow.status === 'queued'">
                        <JobProgress
                            v-if="workflow.job"
                            :job="workflow.job"
                            :previous-progress="visibleProgress"
                            :transient-error="transientError" />
                        <UAlert
                            color="primary"
                            variant="soft"
                            icon="i-lucide-mail"
                            title="Link queued for delivery"
                            :description="
                                maskedSubmittedEmail
                                    ? `Sending to ${maskedSubmittedEmail} when the cut finishes.`
                                    : 'The download link will be sent by email.'
                            " />
                    </template>

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
                        :can-browser-download="canBrowserDownload"
                        :browser-download-error="browserDownloadError"
                        :is-browser-download-starting="isBrowserDownloadStarting"
                        :can-delete="canDelete"
                        :is-deleting="isDeleting"
                        :deleted="deleted"
                        @download="downloadReadyJob"
                        @delete="deleteReadyJob"
                        @start-over="startOver" />
                </div>

                <UAlert
                    v-if="pageError"
                    class="mt-4"
                    color="error"
                    variant="soft"
                    icon="i-lucide-circle-alert"
                    :title="pageError.message"
                    :description="pageError.guidance"
                    role="alert" />

                <UButton
                    v-if="workflow.status === 'failed' && !workflow.job"
                    type="button"
                    class="mt-4"
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-refresh-cw"
                    @click="startOver">
                    Start over
                </UButton>
            </div>
            <div class="min-w-0 lg:col-start-1">
                <div class="pane pane-settle pane-settle-1 p-5 sm:p-6">
                    <ChapterSplits />

                    <div class="border-muted mt-5 border-t pt-5">
                        <p class="micro-label">What comes back</p>
                        <div class="mt-3.5 flex flex-wrap items-center gap-1.5">
                            <span
                                class="bg-inverted text-inverted rounded-md px-2.5 py-1 text-sm font-semibold">
                                one-audiobook.m4b
                            </span>
                            <UIcon
                                name="i-lucide-arrow-right"
                                class="text-primary mx-0.5 size-3.5 shrink-0" />
                            <span
                                class="border-muted text-toned bg-default rounded-md border px-2.5 py-1 text-sm">
                                01_chapter.mp3
                            </span>
                            <span
                                class="border-muted text-toned bg-default rounded-md border px-2.5 py-1 text-sm">
                                02_chapter.mp3
                            </span>
                            <span
                                class="border-muted text-dimmed bg-default rounded-md border px-2.5 py-1 text-sm">
                                + 3 more
                            </span>
                            <span
                                class="border-primary/40 text-primary bg-primary/10 rounded-md border px-2.5 py-1 text-sm font-semibold">
                                chapters.zip
                            </span>
                        </div>
                        <p class="text-muted mt-4 text-sm">
                            Named in playback order, so any folder-only player keeps the sequence.
                        </p>
                    </div>
                </div>
            </div>
        </section>

        <section
            class="pt-6"
            aria-labelledby="how-it-works">
            <h2
                id="how-it-works"
                class="font-display text-highlighted text-3xl font-bold sm:text-4xl">
                How it works
            </h2>

            <!-- The three steps read as a course: checkpoints along one track line. -->
            <ol class="mt-8 grid gap-8 md:grid-cols-3 md:gap-6">
                <li
                    v-for="layer in layers"
                    :key="layer.index"
                    class="border-primary relative border-t-2 pt-6">
                    <span
                        class="bg-primary absolute -top-[7px] left-0 size-3 rounded-full"
                        aria-hidden="true" />
                    <p
                        class="stat text-primary text-4xl"
                        aria-hidden="true">
                        {{ layer.index }}
                    </p>
                    <h3 class="text-highlighted mt-3 text-xl font-bold text-balance">
                        {{ layer.title }}
                    </h3>
                    <p class="text-muted mt-2 max-w-[42ch]">{{ layer.body }}</p>
                    <p class="data-line data-line-accent mt-4">{{ layer.data }}</p>
                </li>
            </ol>
        </section>

        <section
            class="pane mt-16 grid gap-8 p-8 sm:p-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-center lg:gap-14">
            <div>
                <h2
                    class="font-display text-highlighted max-w-[24ch] text-3xl font-bold text-balance sm:text-4xl">
                    Built for the players that refuse one long file
                </h2>
                <p class="text-toned mt-4 max-w-[56ch]">
                    It started as a script for a running watch that would not play a ten-hour M4B.
                    It runs on one machine, one job at a time, free — and it improves from the files
                    people tell it about.
                </p>
            </div>
            <div class="flex flex-col items-start gap-3">
                <UButton
                    class="action-pill"
                    to="/contact"
                    size="lg"
                    icon="i-lucide-message-square-plus">
                    Report a file that failed
                </UButton>
                <UButton
                    to="/about"
                    color="neutral"
                    variant="ghost"
                    size="lg"
                    icon="i-lucide-arrow-right">
                    Read the story
                </UButton>
            </div>
        </section>
    </div>
</template>
