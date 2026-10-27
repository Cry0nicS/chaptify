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
            class="micro-label block"
            for="audiobook-file">
            Audiobook file
        </label>

        <div
            class="has-[input:focus-visible]:outline-primary @container rounded-lg border-2 border-dashed p-5 transition-colors has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2"
            :class="
                isDragActive
                    ? 'border-primary bg-primary/10'
                    : 'border-accented/50 bg-muted hover:border-primary/70'
            "
            @dragenter.prevent="isDragActive = true"
            @dragover.prevent="isDragActive = true"
            @dragleave.prevent="isDragActive = false"
            @drop.prevent="onDrop">
            <div
                class="flex flex-col items-start gap-4 @md:flex-row @md:items-center @md:justify-between">
                <div class="flex items-center gap-4">
                    <span
                        class="border-default bg-default flex size-11 shrink-0 items-center justify-center rounded-md border"
                        aria-hidden="true">
                        <UIcon
                            name="i-lucide-file-audio"
                            class="text-primary size-5" />
                    </span>
                    <div class="space-y-0.5">
                        <p class="text-highlighted font-semibold">Drop one audiobook here</p>
                        <p
                            id="file-help"
                            class="data-line">
                            M4B or MP3 · up to 1.6 GB
                        </p>
                    </div>
                </div>

                <UButton
                    type="button"
                    color="neutral"
                    variant="outline"
                    size="lg"
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
