<script setup lang="ts">
import {SITE_DESCRIPTION, SITE_NAME} from "#shared/utils/constants";
import {useSiteOrigin} from "~/composables/use-site-origin";

const origin = useSiteOrigin();
const {cloudflareBeaconToken} = useRuntimeConfig().public;

// Global, site-wide head: language, brand title template, static social defaults, and WebSite
// structured data. Per-page title/description/canonical live in the useSeo composable.
useHead({
    htmlAttrs: {
        lang: "en"
    },
    titleTemplate: (title?: string | null) => (title ? `${title} · ${SITE_NAME}` : SITE_NAME),
    meta: [
        {name: "theme-color", content: "#f7f4ec", media: "(prefers-color-scheme: light)"},
        {name: "theme-color", content: "#131120", media: "(prefers-color-scheme: dark)"},
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

// Cloudflare Web Analytics (RUM). Cookieless — no cookies, no browser storage, no fingerprinting —
// so it stays within the consent-exempt model documented on /privacy. The app hostname is
// DNS-only (grey-cloud) in Cloudflare, so automatic script injection is unavailable and the beacon
// must be embedded here. Loaded only when a token is configured, and never in dev — Cloudflare's
// RUM endpoint only accepts the registered production hostname, so from localhost the beacon just
// spams the console with CORS errors.
if (cloudflareBeaconToken && !import.meta.dev) {
    useHead({
        script: [
            {
                "src": "https://static.cloudflareinsights.com/beacon.min.js",
                "defer": true,
                "data-cf-beacon": JSON.stringify({token: cloudflareBeaconToken})
            }
        ]
    });
}
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
