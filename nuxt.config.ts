export default defineNuxtConfig({
    compatibilityDate: "2025-01-15",

    eslint: {
        config: {
            standalone: false // <--- Required for Antfu ESLint config.
        }
    },

    modules: ["@nuxt/eslint", "@nuxt/ui"],

    // The server runs on Node 22 only; raise the Nitro esbuild target above es2019 so modern
    // syntax such as BigInt literals (used in IPv6 CIDR matching) is supported without warnings.
    nitro: {
        esbuild: {
            options: {
                target: "es2022"
            }
        }
    },

    devtools: {
        enabled: true
    },

    css: ["~/assets/css/main.css"],

    runtimeConfig: {
        // Public absolute origin used in emailed download links (NUXT_SITE_URL). Distinct from
        // Nuxt's reserved NUXT_APP_BASE_URL, which is a route path prefix and stays untouched.
        siteUrl: "http://localhost:3000",
        storageRoot: "",
        maxUploadBytes: "1610612736",
        maxQueuedJobs: "10",
        maxConcurrentUploads: "2",
        uploadIdleTimeoutSeconds: "30",
        trustProxy: "",
        perIpUploadLimit: "5",
        perIpJobLimit: "5",
        downloadRateLimit: "30",
        storageReservationMultiplier: "4",
        storageReservationSafetyBytes: "268435456",
        storageReservationTtlMinutes: "120",
        orphanJobDirectoryMinAgeMinutes: "30",
        cleanupIntervalSeconds: "300",
        browserDownloadGrantLifetimeSeconds: "60",
        browserDownloadGrantUsedGraceSeconds: "300",
        workerConcurrency: "1",
        jobRetentionHours: "12",
        maxAudiobookDurationSeconds: "108000",
        maxChapters: "300",
        fallbackSegmentSeconds: "1800",
        minSegmentedDurationSeconds: "3600",
        jobProcessingTimeoutSeconds: "14400",
        ffprobeTimeoutSeconds: "30",
        ffmpegChapterTimeoutSeconds: "1200",
        emailRetryAttempts: "3",
        downloadSigningSecret: process.env.NUXT_DOWNLOAD_SIGNING_SECRET || "",
        emailRetryBaseDelaySeconds: "60",
        emailRetryMaxDelaySeconds: "3600",
        mailgunBaseUrl: process.env.NUXT_MAILGUN_BASE_URL || "",
        mailgunDomain: process.env.NUXT_MAILGUN_DOMAIN || "",
        mailgunKey: process.env.NUXT_MAILGUN_KEY || "",
        mailgunSender: process.env.NUXT_MAILGUN_SENDER || "",
        mailgunBcc: process.env.NUXT_MAILGUN_BCC || "",
        contactRecipient: process.env.NUXT_CONTACT_RECIPIENT || "",
        contactRateLimit: "5"
    },

    colorMode: {
        fallback: "dark",
        preference: "system"
    },

    ui: {
        colorMode: true
    },

    typescript: {
        strict: true,
        typeCheck: true
    }
});
