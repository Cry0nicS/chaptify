<script setup lang="ts">
import type {OutputFormat} from "#shared/utils/types";
import type {FileValidationResult} from "../utils/file-validation";
import {computed} from "vue";
import {validateEmailAddress} from "../utils/email";
import {getAudiobookExtension, validateAudiobookFile} from "../utils/file-validation";

const props = defineProps<{
    file: File | null;
    email: string;
    outputFormat: OutputFormat;
    disabled?: boolean;
    isUploading?: boolean;
    uploadProgressLabel?: string;
    uploadProgressPercent?: number;
}>();

const emit = defineEmits<{
    "update:email": [value: string];
    "update:outputFormat": [value: OutputFormat];
    "fileSelected": [file: File];
    "fileRemoved": [];
    "submit": [];
}>();

// The source format determines which target is valid: converting to the same format is excluded, so
// the matching option is disabled and the other is the only choice.
const sourceFormat = computed<OutputFormat | null>(() =>
    props.file ? getAudiobookExtension(props.file.name) : null
);
const outputFormatItems = computed(() => [
    {label: "MP3", value: "mp3", disabled: sourceFormat.value === "mp3"},
    {label: "M4B", value: "m4b", disabled: sourceFormat.value === "m4b"}
]);

const onOutputFormatChange = (value: unknown) => {
    if (value === "mp3" || value === "m4b") {
        emit("update:outputFormat", value);
    }
};

const emailError = computed(() => {
    if (!props.email.trim()) {
        return null;
    }

    return validateEmailAddress(props.email);
});

const fileValidation = computed<FileValidationResult>(() => validateAudiobookFile(props.file));
const canSubmit = computed(
    () =>
        fileValidation.value.valid &&
        Boolean(props.email.trim()) &&
        !emailError.value &&
        (!sourceFormat.value || props.outputFormat !== sourceFormat.value) &&
        !props.disabled &&
        !props.isUploading
);
</script>

<template>
    <form
        class="space-y-6"
        novalidate
        @submit.prevent="emit('submit')">
        <FileDropzone
            :file="file"
            :disabled="disabled || isUploading"
            @file-selected="emit('fileSelected', $event)"
            @file-removed="emit('fileRemoved')" />

        <div class="space-y-2">
            <span class="text-highlighted block text-sm font-medium">Convert to</span>
            <URadioGroup
                :model-value="outputFormat"
                :items="outputFormatItems"
                orientation="horizontal"
                :disabled="disabled || isUploading"
                aria-describedby="convert-format-help"
                @update:model-value="onOutputFormatChange" />
            <p
                id="convert-format-help"
                class="text-muted text-sm">
                The target format. Metadata, cover art, and chapters are preserved.
            </p>
        </div>

        <div class="space-y-2">
            <label
                class="text-highlighted block text-sm font-medium"
                for="convert-email">
                Email address
            </label>
            <UInput
                id="convert-email"
                :model-value="email"
                type="email"
                autocomplete="email"
                placeholder="you@example.com"
                :disabled="disabled || isUploading"
                :aria-invalid="Boolean(emailError)"
                aria-describedby="convert-email-help convert-email-error"
                class="w-full"
                @update:model-value="emit('update:email', String($event))" />
            <p
                id="convert-email-help"
                class="text-muted text-sm">
                Processing happens on our server and can take a few minutes. We email the download
                link when it is ready — keep this tab open to grab it sooner.
            </p>
            <p
                v-if="emailError"
                id="convert-email-error"
                class="text-error text-sm"
                role="alert">
                {{ emailError }}
            </p>
        </div>

        <div
            v-if="isUploading"
            class="border-default bg-muted/30 space-y-3 rounded-lg border p-4"
            aria-live="polite">
            <div class="flex items-center justify-between gap-4">
                <p class="text-highlighted text-sm font-medium">Uploading file</p>
                <p class="text-muted font-mono text-sm tabular-nums">
                    {{ uploadProgressPercent }}%
                </p>
            </div>
            <UProgress
                :model-value="uploadProgressPercent"
                :max="100"
                status />
            <p class="text-muted text-sm">{{ uploadProgressLabel }}</p>
            <p class="text-warning text-sm">
                Keep this browser tab open until the upload finishes.
            </p>
        </div>

        <UButton
            type="submit"
            size="xl"
            block
            icon="i-lucide-repeat"
            :loading="isUploading"
            :disabled="!canSubmit">
            Convert file
        </UButton>
    </form>
</template>
