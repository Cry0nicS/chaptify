<script setup lang="ts">
import type {FileValidationResult} from "../utils/file-validation";
import {computed, ref} from "vue";
import {validateAudiobookFile} from "../utils/file-validation";

/**
 * Shared audiobook file picker (drag-and-drop + native input + validation), used by both the split
 * and convert upload forms. It owns only file selection; the surrounding form owns email, format,
 * and submission.
 */
const props = defineProps<{
    file: File | null;
    disabled?: boolean;
}>();

const emit = defineEmits<{
    fileSelected: [file: File];
    fileRemoved: [];
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const isDragActive = ref(false);
const fileError = ref<string | null>(null);
const fileValidation = computed<FileValidationResult>(() => validateAudiobookFile(props.file));

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

    if (props.disabled || !event.dataTransfer?.files) {
        return;
    }

    handleFiles(event.dataTransfer.files);
};

defineExpose({
    clearNativeFileInput: removeFile
});
</script>

<template>
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
                        M4B or MP3. Server upload limits apply.
                    </p>
                </div>

                <UButton
                    type="button"
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-upload"
                    :disabled="disabled"
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
                :disabled="disabled"
                aria-describedby="file-help file-error"
                @change="onNativeFileChange" />
        </div>

        <SelectedFileSummary
            v-if="file"
            :file="file"
            :disabled="disabled"
            @remove="removeFile" />

        <p
            v-if="fileError || (file && fileValidation.message)"
            id="file-error"
            class="text-error text-sm"
            role="alert">
            {{ fileError || fileValidation.message }}
        </p>
    </div>
</template>
