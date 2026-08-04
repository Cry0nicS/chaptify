<script setup lang="ts">
import {computed} from "vue";
import {getAudiobookExtension} from "../utils/file-validation";
import {formatFileSize} from "../utils/format-file-size";

const props = defineProps<{
    file: File;
    disabled?: boolean;
}>();

const emit = defineEmits<{
    remove: [];
}>();

const extension = computed(() => getAudiobookExtension(props.file.name)?.toUpperCase() || "File");
</script>

<template>
    <div class="pane-quiet border-default border p-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="min-w-0">
                <p
                    class="text-highlighted truncate text-sm font-medium"
                    :title="file.name">
                    {{ file.name }}
                </p>
                <p class="data-line mt-1">{{ formatFileSize(file.size) }} · {{ extension }}</p>
            </div>

            <UButton
                type="button"
                class="rounded-full"
                color="neutral"
                variant="subtle"
                icon="i-lucide-x"
                :disabled="disabled"
                @click="emit('remove')">
                Remove
            </UButton>
        </div>
    </div>
</template>
