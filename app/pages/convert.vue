<script setup lang="ts">
import {useConversionWorkflow} from "../composables/use-conversion-workflow";

definePageMeta({
    layout: "default"
});

useSeo({
    title: "MP3 to M4B converter — and M4B to MP3",
    description:
        "Free online audiobook converter between MP3 and M4B. Keeps chapters, cover art, and metadata. Upload one file and get the converted download by email."
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

const hasJobState = computed(
    () =>
        Boolean(pageError.value) ||
        Boolean(deleteError.value) ||
        Boolean(terminalJob.value) ||
        workflow.value.status === "queued" ||
        workflow.value.status === "processing" ||
        (workflow.value.status === "failed" && !workflow.value.job)
);

// Shown as one row of chips: what survives the re-encode.
const preserved = [
    {icon: "i-lucide-bookmark", label: "Chapters kept"},
    {icon: "i-lucide-image", label: "Cover art kept"},
    {icon: "i-lucide-tags", label: "Tags kept"}
];

const layers = [
    {
        index: "01",
        title: "One file, one address",
        body: "Drop in the MP3 or M4B you own and pick the container you need. Songs and clips work too — no chapter marks required.",
        data: "MP3 ⇄ M4B · 1.6 GB in"
    },
    {
        index: "02",
        title: "A faithful re-encode",
        body: "MP3 and M4B never share a codec, so the audio is always re-encoded — but chapters, cover art and tags are carried across, not stripped.",
        data: "ffmpeg · metadata kept"
    },
    {
        index: "03",
        title: "Grab it, then delete it",
        body: "Download from this tab or the email. Press delete when you have it, or leave it and the file removes itself.",
        data: "TTL 12 h · delete on demand"
    }
];
</script>

<template>
    <div class="pb-16">
        <section
            class="grid gap-10 pt-12 pb-10 lg:grid-cols-[minmax(0,1fr)_minmax(27rem,0.9fr)] lg:gap-14 lg:pt-16">
            <div class="lg:pt-2">
                <h1
                    class="font-display text-highlighted max-w-[20ch] text-4xl font-bold tracking-[-0.042em] text-balance sm:text-5xl lg:text-6xl">
                    Convert an audiobook
                    <span class="text-primary">between</span>
                    MP3 and M4B.
                </h1>

                <p class="text-toned mt-6 max-w-[52ch] text-base sm:text-lg">
                    Upload one file and get it back in the other container — chapters, cover art and
                    metadata preserved. The download link is emailed and expires after 12 hours.
                </p>

                <dl
                    class="border-default mt-8 grid grid-cols-2 gap-x-8 gap-y-5 border-t pt-6 sm:flex sm:flex-wrap sm:gap-x-10">
                    <div>
                        <dt class="micro-label">Accepts</dt>
                        <dd class="text-highlighted mt-1 font-semibold">M4B · MP3</dd>
                    </div>
                    <div>
                        <dt class="micro-label">Up to</dt>
                        <dd class="text-highlighted mt-1 font-semibold">1.6 GB · 30 h</dd>
                    </div>
                    <div>
                        <dt class="micro-label">Chapters needed</dt>
                        <dd class="text-highlighted mt-1 font-semibold">No</dd>
                    </div>
                    <div>
                        <dt class="micro-label">Cost</dt>
                        <dd class="text-highlighted mt-1 font-semibold">Free · no account</dd>
                    </div>
                </dl>

                <div class="pane pane-settle pane-settle-1 mt-10 p-5 sm:p-6">
                    <p class="micro-label">The swap</p>

                    <div class="mt-5 flex items-center justify-center gap-4 sm:gap-7">
                        <p
                            class="text-highlighted font-display text-3xl font-bold tracking-tight sm:text-4xl">
                            MP3
                        </p>
                        <UIcon
                            name="i-lucide-repeat"
                            class="text-primary size-6 shrink-0 sm:size-7" />
                        <p
                            class="text-highlighted font-display text-3xl font-bold tracking-tight sm:text-4xl">
                            M4B
                        </p>
                    </div>

                    <ul class="border-muted mt-6 flex flex-wrap gap-2 border-t pt-5">
                        <li
                            v-for="item in preserved"
                            :key="item.label"
                            class="border-muted text-toned flex items-center gap-2 rounded-full border bg-white/85 px-3 py-1.5 text-sm dark:bg-white/10">
                            <UIcon
                                :name="item.icon"
                                class="text-secondary size-3.5 shrink-0" />
                            {{ item.label }}
                        </li>
                    </ul>

                    <p class="border-muted text-muted mt-5 border-t pt-4 text-sm">
                        Need per-chapter files instead of one converted file?
                        <ULink
                            class="text-primary font-medium"
                            to="/">
                            Split the audiobook
                        </ULink>
                    </p>
                </div>
            </div>

            <div class="lg:sticky lg:top-24 lg:self-start">
                <div class="pane pane-front pane-settle pane-settle-2 p-5 sm:p-6">
                    <div class="mb-5 flex items-center justify-between gap-4">
                        <h2 class="text-highlighted text-lg font-semibold tracking-tight">
                            Convert your audiobook
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

                    <p class="border-muted text-muted mt-5 border-t pt-4 text-sm">
                        Your file is processed, then deleted with its result after 12 hours. Only
                        upload audio you own or are authorised to convert.
                    </p>
                </div>
            </div>
        </section>

        <section
            v-if="hasJobState"
            class="mb-12 flex flex-col gap-4">
            <UAlert
                v-if="pageError"
                color="error"
                variant="soft"
                icon="i-lucide-circle-alert"
                :title="pageError.message"
                :description="pageError.guidance"
                role="alert" />

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
                            ? `Sending to ${maskedSubmittedEmail} when the conversion finishes.`
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
                    class="rounded-full"
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-refresh-cw"
                    @click="startOver">
                    Start over
                </UButton>
            </div>
        </section>

        <section
            class="grid gap-5 md:grid-cols-3 md:items-start"
            aria-labelledby="convert-how">
            <h2
                id="convert-how"
                class="sr-only">
                How it works
            </h2>
            <article
                v-for="(layer, index) in layers"
                :key="layer.index"
                class="pane pane-lift p-6"
                :class="index === 0 ? 'md:mt-16' : index === 1 ? 'md:mt-8' : ''">
                <p class="data-line text-primary">{{ layer.index }}</p>
                <h3
                    class="text-highlighted mt-6 text-xl font-semibold tracking-[-0.025em] text-balance">
                    {{ layer.title }}
                </h3>
                <p class="text-muted mt-2.5 text-sm">{{ layer.body }}</p>
                <p class="border-muted data-line data-line-accent mt-5 border-t pt-3.5">
                    {{ layer.data }}
                </p>
            </article>
        </section>
    </div>
</template>
