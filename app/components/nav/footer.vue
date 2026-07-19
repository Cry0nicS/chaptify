<script setup lang="ts">
const slots = useSlots();

const currentYear = computed(() => new Date().getFullYear());
</script>

<template>
    <footer class="border-default border-t">
        <div
            class="mx-auto flex max-w-(--ui-container) flex-col items-center justify-between gap-6 px-4 py-10 sm:px-6 md:flex-row lg:px-8">
            <div class="flex flex-col items-center gap-1 md:items-start">
                <p class="text-muted text-sm">&copy; {{ currentYear }} Chaptify</p>
                <p class="text-dimmed font-mono text-xs tracking-wide">
                    Split audiobooks. Keep running.
                </p>
            </div>

            <nav
                v-if="slots.links"
                class="flex flex-col items-center gap-6 md:flex-row xl:gap-4">
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
