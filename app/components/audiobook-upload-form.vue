<script setup lang="ts">
import type {OutputFormat} from "#shared/utils/types";
import type {FileValidationResult} from "../utils/file-validation";
import {computed} from "vue";
import {validateEmailAddress} from "../utils/email";
import {validateAudiobookFile} from "../utils/file-validation";

const props = defineProps<{
    file: File | null;
    email: string;
    outputFormat: OutputFormat;
    splitWithoutChapters: boolean;
    disabled?: boolean;
    isUploading?: boolean;
    uploadProgressLabel?: string;
    uploadProgressPercent?: number;
}>();

const emit = defineEmits<{
    "update:email": [value: string];
    "update:outputFormat": [value: OutputFormat];
    "update:splitWithoutChapters": [value: boolean];
    "fileSelected": [file: File];
    "fileRemoved": [];
    "submit": [];
}>();

const outputFormatItems = [
    {label: "MP3", value: "mp3"},
    {label: "M4B", value: "m4b"}
];

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
            <span class="micro-label block">Output format</span>
            <URadioGroup
                :model-value="outputFormat"
                :items="outputFormatItems"
                orientation="horizontal"
                :disabled="disabled || isUploading"
                aria-describedby="output-format-help"
                @update:model-value="onOutputFormatChange" />
            <p
                id="output-format-help"
                class="text-muted text-sm">
                The format for the chapter files. If it differs from the uploaded audiobook,
                Chaptify re-encodes the audio, which takes a little longer.
            </p>
        </div>

        <div class="pane-quiet border-default border p-4">
            <div class="flex items-start justify-between gap-4">
                <div class="space-y-1">
                    <label
                        class="text-highlighted block font-medium"
                        for="split-without-chapters">
                        No chapters? Split into 30-minute parts
                    </label>
                    <p
                        id="split-help"
                        class="text-muted text-sm">
                        If the audiobook has no embedded chapter marks, split it into fixed
                        30-minute segments instead of failing. Only applies to longer files.
                    </p>
                </div>
                <USwitch
                    id="split-without-chapters"
                    :model-value="splitWithoutChapters"
                    :disabled="disabled || isUploading"
                    aria-describedby="split-help"
                    @update:model-value="emit('update:splitWithoutChapters', Boolean($event))" />
            </div>
        </div>

        <div class="space-y-2">
            <label
                class="micro-label block"
                for="email">
                Email address
            </label>
            <UInput
                id="email"
                :model-value="email"
                type="email"
                autocomplete="email"
                placeholder="you@example.com"
                :disabled="disabled || isUploading"
                :aria-invalid="Boolean(emailError)"
                aria-describedby="email-help email-error"
                class="w-full"
                @update:model-value="emit('update:email', String($event))" />
            <p
                id="email-help"
                class="text-muted text-sm">
                Chaptify emails the temporary download link after processing finishes.
            </p>
            <p
                v-if="emailError"
                id="email-error"
                class="text-error text-sm"
                role="alert">
                {{ emailError }}
            </p>
        </div>

        <div
            v-if="isUploading"
            class="pane-quiet border-default space-y-3 border p-4"
            aria-live="polite">
            <div class="flex items-center justify-between gap-4">
                <p class="text-highlighted text-sm font-medium">Uploading audiobook</p>
                <p class="data-line data-line-accent text-sm">{{ uploadProgressPercent }}%</p>
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
            class="action-pill"
            size="xl"
            block
            icon="i-lucide-scissors"
            :loading="isUploading"
            :disabled="!canSubmit">
            Split audiobook into chapters
        </UButton>
    </form>
</template>
