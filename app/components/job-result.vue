<script setup lang="ts">
import type {JobStatusResponse} from "#shared/utils/types";
import {computed} from "vue";
import {guidanceForErrorCode} from "../utils/api-errors";
import {formatExpiration} from "../utils/date-format";

const props = defineProps<{
    job: JobStatusResponse;
}>();

const emit = defineEmits<{
    startOver: [];
}>();

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
        return "The email contains the secure download link for your ZIP.";
    }

    if (props.job.emailStatus === "failed") {
        return "The audiobook was processed successfully, but the email could not be delivered. There is no resend option yet; start over with a verified address if you need a new email.";
    }

    return "The ZIP is ready and the server is still trying to send the email.";
});
</script>

<template>
    <section class="border-default bg-default space-y-4 rounded-lg border p-5">
        <template v-if="job.status === 'ready'">
            <UAlert
                color="success"
                variant="soft"
                icon="i-lucide-circle-check"
                title="Audiobook processed"
                description="Your chapter ZIP is ready. The secure download link is sent by email and is not shown on this page." />

            <UAlert
                :color="job.emailStatus === 'failed' ? 'warning' : 'primary'"
                variant="soft"
                :icon="job.emailStatus === 'failed' ? 'i-lucide-mail-x' : 'i-lucide-mail-check'"
                :title="emailTitle"
                :description="emailMessage" />

            <p class="text-muted text-sm">
                <span v-if="expiration">
                    The download link expires {{ expiration }}. The ZIP will be deleted
                    automatically.
                </span>
                <span v-else>
                    The ZIP will be deleted automatically after the configured retention period.
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
                description="The generated file and email link have expired. Upload the audiobook again to create a fresh ZIP." />
        </template>

        <UButton
            type="button"
            size="lg"
            icon="i-lucide-refresh-cw"
            @click="emit('startOver')">
            Process another audiobook
        </UButton>
    </section>
</template>
