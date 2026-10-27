<script setup lang="ts">
import type {JobStatusResponse} from "#shared/utils/types";
import {computed} from "vue";
import {displayProcessingProgress, hasChapterProgress} from "../utils/progress";

const props = withDefaults(
    defineProps<{
        job: JobStatusResponse;
        transientError?: string | null;
        previousProgress?: number;
        // The status response carries no job kind, so the page says which flow this is.
        kind?: "split" | "convert";
    }>(),
    {kind: "split"}
);

const displayProgress = computed(() =>
    displayProcessingProgress(props.job.status, props.previousProgress ?? 0, props.job.progress)
);

const hasLaps = computed(() =>
    hasChapterProgress(props.job.currentChapter, props.job.totalChapters)
);

const statusTitle = computed(() =>
    props.job.status === "queued" ? "Queued for processing" : "Processing your audiobook"
);

const statusMessage = computed(() => {
    if (props.job.status === "queued") {
        return "Your upload is complete and waiting for the worker to start.";
    }

    if (hasLaps.value) {
        return `Processing chapter ${props.job.currentChapter} of ${props.job.totalChapters}`;
    }

    return props.kind === "convert"
        ? "Chaptify is converting the file to its new format."
        : "Chaptify is reading embedded chapters and preparing files.";
});

const downloadLinkLabel = computed(() =>
    props.kind === "convert" ? "The download link" : "The ZIP download link"
);
</script>

<template>
    <section
        class="pane space-y-4 p-6"
        aria-live="polite">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
                <UBadge
                    color="primary"
                    variant="soft"
                    class="mb-2">
                    {{ job.status }}
                </UBadge>
                <h2 class="text-highlighted text-lg font-semibold">{{ statusTitle }}</h2>
                <p class="text-muted text-sm">{{ statusMessage }}</p>
            </div>
            <div class="flex items-end gap-6 sm:text-right">
                <div v-if="hasLaps">
                    <p class="micro-label">Lap</p>
                    <p class="stat text-highlighted mt-1 flex items-baseline text-3xl">
                        <span>{{ job.currentChapter }}</span>
                        <span class="text-muted text-xl">/{{ job.totalChapters }}</span>
                    </p>
                </div>
                <div>
                    <p class="micro-label">Done</p>
                    <p class="stat text-secondary mt-1 text-5xl">{{ displayProgress }}%</p>
                </div>
            </div>
        </div>

        <UProgress
            :model-value="displayProgress"
            :max="100" />

        <p class="text-muted text-sm">
            Once the upload is complete, you may leave this page. {{ downloadLinkLabel }} will be
            sent by email.
        </p>
        <UAlert
            v-if="transientError"
            color="warning"
            variant="soft"
            icon="i-lucide-wifi-off"
            title="Status refresh delayed"
            :description="transientError" />
    </section>
</template>
