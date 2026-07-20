<script setup lang="ts">
import type {JobStatusResponse} from "#shared/utils/types";
import {computed} from "vue";
import {guidanceForErrorCode} from "../utils/api-errors";
import {formatExpiration} from "../utils/date-format";

const props = withDefaults(
    defineProps<{
        job: JobStatusResponse;
        kind?: "split" | "convert";
        canBrowserDownload?: boolean;
        browserDownloadError?: string | null;
        isBrowserDownloadStarting?: boolean;
        canDelete?: boolean;
        isDeleting?: boolean;
        deleted?: boolean;
    }>(),
    {kind: "split"}
);

const emit = defineEmits<{
    download: [];
    startOver: [];
    delete: [];
}>();

const isConvert = computed(() => props.kind === "convert");
const artifactNoun = computed(() => (isConvert.value ? "converted file" : "chapter ZIP"));
const readyDescription = computed(
    () =>
        `Your ${artifactNoun.value} is ready. You can download it here in this tab, and the emailed temporary link will continue to work.`
);
const downloadLabel = computed(() => (isConvert.value ? "Download file" : "Download ZIP"));
const startOverLabel = computed(() =>
    isConvert.value ? "Convert another file" : "Process another audiobook"
);

const expiration = computed(() => formatExpiration(props.job.expiresAt));
const failedGuidance = computed(() =>
    props.job.error
        ? guidanceForErrorCode(props.job.error.code)
        : "Please start over and try again."
);
const emailTitle = computed(() => {
    if (props.job.emailStatus === "sent") {
        return "Completion email sent";
    }

    if (props.job.emailStatus === "failed") {
        return "Email delivery failed";
    }

    return "Completion email pending";
});
const emailMessage = computed(() => {
    if (props.job.emailStatus === "sent") {
        return "The email contains the secure download link.";
    }

    if (props.job.emailStatus === "failed") {
        return "The file was processed successfully, but the email could not be delivered. There is no resend option yet; start over with a verified address if you need a new email.";
    }

    return "The download is ready and the server is still trying to send the email.";
});
</script>

<template>
    <section class="border-default bg-default space-y-4 rounded-lg border p-5">
        <template v-if="deleted">
            <UAlert
                color="neutral"
                variant="soft"
                icon="i-lucide-trash-2"
                title="File deleted"
                description="The file and its download links have been removed from our servers." />
        </template>

        <template v-else-if="job.status === 'ready'">
            <UAlert
                color="success"
                variant="soft"
                icon="i-lucide-circle-check"
                :title="isConvert ? 'File converted' : 'Audiobook processed'"
                :description="readyDescription" />

            <div
                v-if="canBrowserDownload"
                class="flex flex-col gap-3 sm:flex-row">
                <UButton
                    type="button"
                    size="lg"
                    icon="i-lucide-download"
                    :loading="isBrowserDownloadStarting"
                    @click="emit('download')">
                    {{ downloadLabel }}
                </UButton>

                <UButton
                    v-if="canDelete"
                    type="button"
                    size="lg"
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-trash-2"
                    :loading="isDeleting"
                    @click="emit('delete')">
                    Delete file now
                </UButton>
            </div>

            <UAlert
                v-if="browserDownloadError"
                color="warning"
                variant="soft"
                icon="i-lucide-circle-alert"
                title="Direct download unavailable"
                :description="browserDownloadError" />

            <UAlert
                :color="job.emailStatus === 'failed' ? 'warning' : 'primary'"
                variant="soft"
                :icon="job.emailStatus === 'failed' ? 'i-lucide-mail-x' : 'i-lucide-mail-check'"
                :title="emailTitle"
                :description="emailMessage" />

            <p class="text-muted text-sm">
                <span v-if="expiration">
                    The download link expires {{ expiration }}. The file will be deleted
                    automatically.
                </span>
                <span v-else>
                    The file will be deleted automatically after the configured retention period.
                </span>
            </p>
        </template>

        <template v-else-if="job.status === 'failed'">
            <UAlert
                color="error"
                variant="soft"
                icon="i-lucide-circle-alert"
                :title="job.error?.message || 'Processing failed'"
                :description="failedGuidance" />
        </template>

        <template v-else>
            <UAlert
                color="neutral"
                variant="soft"
                icon="i-lucide-clock"
                title="Download expired"
                description="The generated file and email link have expired. Upload again to create a fresh download." />
        </template>

        <UButton
            type="button"
            size="lg"
            icon="i-lucide-refresh-cw"
            @click="emit('startOver')">
            {{ startOverLabel }}
        </UButton>
    </section>
</template>
