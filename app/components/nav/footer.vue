<script setup lang="ts">
const slots = useSlots();

const currentYear = computed(() => new Date().getFullYear());
</script>

<template>
    <footer class="border-default relative z-1 mt-auto border-t">
        <div
            class="mx-auto flex max-w-(--ui-container) flex-col items-center justify-between gap-5 px-4 py-8 sm:px-6 md:flex-row lg:px-8">
            <div class="flex flex-col items-center gap-1.5 md:items-start">
                <p class="text-muted text-sm">&copy; {{ currentYear }} Chaptify</p>
                <p class="data-line">chaptify.app · split audiobooks by their chapter table</p>
            </div>

            <nav
                v-if="slots.links"
                class="flex flex-wrap items-center justify-center gap-1"
                aria-label="Footer">
                <slot name="links" />
            </nav>

            <div
                v-if="slots.social"
                class="flex flex-row items-center gap-3">
                <slot name="social" />
            </div>
        </div>
    </footer>
</template>
