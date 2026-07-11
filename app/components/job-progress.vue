<script setup lang="ts">
import type {JobStatusResponse} from "#shared/utils/types";
import {computed} from "vue";
import {displayProcessingProgress, hasChapterProgress} from "../utils/progress";

const props = defineProps<{
    job: JobStatusResponse;
    transientError?: string | null;
    previousProgress?: number;
}>();

const displayProgress = computed(() =>
    displayProcessingProgress(props.job.status, props.previousProgress ?? 0, props.job.progress)
);

const chapterLabel = computed(() => {
    if (!hasChapterProgress(props.job.currentChapter, props.job.totalChapters)) {
        return null;
    }

    return `Processing chapter ${props.job.currentChapter} of ${props.job.totalChapters}`;
});

const statusTitle = computed(() =>
    props.job.status === "queued" ? "Queued for processing" : "Processing your audiobook"
);

const statusMessage = computed(() => {
    if (props.job.status === "queued") {
        return "Your upload is complete and waiting for the worker to start.";
    }

    return chapterLabel.value || "Chaptify is reading embedded chapters and preparing files.";
});
</script>

<template>
    <section
        class="border-default bg-default space-y-4 rounded-lg border p-5"
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
            <p class="text-highlighted text-2xl font-semibold">{{ displayProgress }}%</p>
        </div>

        <UProgress
            :model-value="displayProgress"
            :max="100"
            status />

        <p
            v-if="chapterLabel"
            class="text-muted text-sm">
            {{ chapterLabel }}
        </p>
        <p class="text-muted text-sm">
            Once the upload is complete, you may leave this page. The ZIP download link will be sent
            by email.
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
