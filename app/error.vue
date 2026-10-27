<script setup lang="ts">
import type {NuxtError} from "#app";
import {SITE_NAME} from "#shared/utils/constants";

/*
 * Site-wide error page. Nuxt renders it instead of app.vue, so it brings its own UApp and layout to
 * keep the header, footer and colour mode. A 404 gets a plain "page not found"; anything else gets a
 * generic message, never the raw error text, which could carry internal detail.
 */
const props = defineProps<{
    error: NuxtError;
}>();

const isNotFound = computed(() => props.error.statusCode === 404);

const title = computed(() => (isNotFound.value ? "Page not found" : "Something went wrong"));

const message = computed(() =>
    isNotFound.value
        ? "The page you were looking for doesn't exist or has moved."
        : "Chaptify hit an unexpected error. Try again in a moment."
);

// app.vue does not render here, so repeat the parts of its head this page still needs.
useHead({
    htmlAttrs: {lang: "en"},
    title: () => `${title.value} · ${SITE_NAME}`,
    meta: [{name: "robots", content: "noindex"}]
});

const goTo = (path: string) => clearError({redirect: path});
</script>

<template>
    <UApp>
        <NuxtLayout>
            <section class="flex min-h-[60svh] flex-col items-start justify-center py-20">
                <p class="stat text-primary text-7xl sm:text-8xl">{{ error.statusCode }}</p>
                <h1
                    class="font-display text-highlighted mt-4 text-4xl font-bold text-balance sm:text-5xl">
                    {{ title }}
                </h1>
                <p class="text-muted mt-3 max-w-[48ch] text-lg">{{ message }}</p>

                <div class="mt-8 flex flex-wrap gap-3">
                    <UButton
                        class="action-pill"
                        size="lg"
                        icon="i-lucide-scissors"
                        @click="goTo('/')">
                        Split an audiobook
                    </UButton>
                    <UButton
                        color="neutral"
                        variant="outline"
                        size="lg"
                        icon="i-lucide-repeat"
                        @click="goTo('/convert')">
                        Convert a file
                    </UButton>
                </div>
            </section>
        </NuxtLayout>
    </UApp>
</template>
