<script setup lang="ts">
import type {OutputFormat} from "#shared/utils/types";
import type {FileValidationResult} from "../utils/file-validation";
import {computed, ref} from "vue";
import {validateEmailAddress} from "../utils/email";
import {validateAudiobookFile} from "../utils/file-validation";

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

const outputFormatItems = [
    {label: "MP3", value: "mp3"},
    {label: "M4B", value: "m4b"}
];

const onOutputFormatChange = (value: unknown) => {
    if (value === "mp3" || value === "m4b") {
        emit("update:outputFormat", value);
    }
};

const fileInput = ref<HTMLInputElement | null>(null);
const isDragActive = ref(false);
const fileError = ref<string | null>(null);

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

const handleFiles = (files: FileList | File[]) => {
    const selected = Array.from(files);

    if (selected.length !== 1) {
        fileError.value = "Choose exactly one audiobook file.";
        return;
    }

    const file = selected[0];

    if (!file) {
        fileError.value = "Choose exactly one audiobook file.";
        return;
    }

    const validation = validateAudiobookFile(file);

    if (!validation.valid) {
        fileError.value = validation.message;
        if (fileInput.value) {
            fileInput.value.value = "";
        }
        return;
    }

    fileError.value = null;
    emit("fileSelected", file);
};

const onNativeFileChange = (event: Event) => {
    const input = event.target as HTMLInputElement;

    if (input.files) {
        handleFiles(input.files);
    }
};

const removeFile = () => {
    if (fileInput.value) {
        fileInput.value.value = "";
    }

    fileError.value = null;
    emit("fileRemoved");
};

const onDrop = (event: DragEvent) => {
    isDragActive.value = false;

    if (props.disabled || props.isUploading || !event.dataTransfer?.files) {
        return;
    }

    handleFiles(event.dataTransfer.files);
};

defineExpose({
    clearNativeFileInput: removeFile
});
</script>

<template>
    <form
        class="space-y-6"
        novalidate
        @submit.prevent="emit('submit')">
        <div class="space-y-3">
            <label
                class="text-highlighted block text-sm font-medium"
                for="audiobook-file">
                Audiobook file
            </label>

            <div
                class="rounded-lg border border-dashed p-5 transition-colors"
                :class="
                    isDragActive
                        ? 'border-primary bg-primary/10'
                        : 'border-default bg-default hover:bg-muted/40'
                "
                @dragenter.prevent="isDragActive = true"
                @dragover.prevent="isDragActive = true"
                @dragleave.prevent="isDragActive = false"
                @drop.prevent="onDrop">
                <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div class="space-y-1">
                        <p class="text-highlighted font-medium">Drop one audiobook here</p>
                        <p
                            id="file-help"
                            class="text-muted text-sm">
                            M4B or MP3 with embedded chapters. Server upload limits apply.
                        </p>
                    </div>

                    <UButton
                        type="button"
                        color="neutral"
                        variant="soft"
                        icon="i-lucide-upload"
                        :disabled="disabled || isUploading"
                        @click="fileInput?.click()">
                        Choose file
                    </UButton>
                </div>

                <input
                    id="audiobook-file"
                    ref="fileInput"
                    class="sr-only"
                    type="file"
                    accept=".m4b,.mp3,audio/mpeg,audio/mp4"
                    :disabled="disabled || isUploading"
                    aria-describedby="file-help file-error"
                    @change="onNativeFileChange" />
            </div>

            <SelectedFileSummary
                v-if="file"
                :file="file"
                :disabled="disabled || isUploading"
                @remove="removeFile" />

            <p
                v-if="fileError || (file && fileValidation.message)"
                id="file-error"
                class="text-error text-sm"
                role="alert">
                {{ fileError || fileValidation.message }}
            </p>
        </div>

        <div class="space-y-2">
            <span class="text-highlighted block text-sm font-medium">Output format</span>
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

        <div class="space-y-2">
            <label
                class="text-highlighted block text-sm font-medium"
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
            class="border-default bg-muted/30 space-y-3 rounded-lg border p-4"
            aria-live="polite">
            <div class="flex items-center justify-between gap-4">
                <p class="text-highlighted text-sm font-medium">Uploading audiobook</p>
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
            icon="i-lucide-scissors"
            :loading="isUploading"
            :disabled="!canSubmit">
            Split audiobook into chapters
        </UButton>
    </form>
</template>
