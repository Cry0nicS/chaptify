<script setup lang="ts">
import {SITE_DESCRIPTION, SITE_NAME} from "#shared/utils/constants";
import {useSiteOrigin} from "~/composables/use-site-origin";

const origin = useSiteOrigin();

// Global, site-wide head: language, brand title template, static social defaults, and WebSite
// structured data. Per-page title/description/canonical live in the useSeo composable.
useHead({
    htmlAttrs: {
        lang: "en"
    },
    titleTemplate: (title?: string | null) => (title ? `${title} · ${SITE_NAME}` : SITE_NAME),
    meta: [
        {name: "theme-color", content: "#7c3aed"},
        {name: "robots", content: "index, follow"},
        {name: "format-detection", content: "telephone=no"},
        {property: "og:site_name", content: SITE_NAME},
        {property: "og:type", content: "website"},
        {property: "og:locale", content: "en_US"},
        {name: "twitter:card", content: "summary"}
    ],
    script: [
        {
            type: "application/ld+json",
            innerHTML: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "WebSite",
                "name": SITE_NAME,
                "url": origin.value || undefined,
                "description": SITE_DESCRIPTION
            })
        }
    ]
});
</script>

<template>
    <UApp>
        <NuxtRouteAnnouncer />
        <NuxtLoadingIndicator />
        <NuxtLayout>
            <NuxtPage />
        </NuxtLayout>
    </UApp>
</template>
