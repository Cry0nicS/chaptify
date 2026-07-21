<script setup lang="ts">
import {useSiteOrigin} from "~/composables/use-site-origin";

const origin = useSiteOrigin();

// Site-wide structured data so search engines understand the site as a whole.
useHead({
    script: [
        {
            type: "application/ld+json",
            innerHTML: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "WebSite",
                "name": "Chaptify",
                "url": origin.value || undefined,
                "description":
                    "Split audiobooks into per-chapter files and convert audiobooks between MP3 and M4B, delivered by a temporary email link."
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
