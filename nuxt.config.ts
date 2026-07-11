// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    compatibilityDate: "2025-01-15",

    eslint: {
        config: {
            standalone: false // <--- Required for Antfu ESLint config.
        }
    },

    // Core Nuxt setup
    modules: ["@nuxt/eslint", "@nuxt/ui", "@nuxtjs/device"],

    devtools: {
        enabled: true
    },

    // Global app assets
    css: ["~/assets/css/main.css"],

    // Server-only and public runtime configuration
    runtimeConfig: {
        appBaseUrl: "http://localhost:3000",
        storageRoot: "",
        maxUploadBytes: "1073741824",
        maxQueuedJobs: "10",
        workerConcurrency: "1",
        jobRetentionHours: "12",
        emailRetryAttempts: "3",
        mailgunBaseUrl: "",
        mailgunDomain: "",
        mailgunKey: "",
        mailgunSender: "",
        mailgunRecipient: "",
        mailgunBcc: "",
        public: {
            nodeEnv: process.env.NUXT_PUBLIC_NODE_ENV || "development"
        }
    },

    // UI configuration
    colorMode: {
        fallback: "dark",
        preference: "system"
    },

    ui: {
        colorMode: true
    },

    // Tooling
    typescript: {
        strict: true,
        typeCheck: true
    }
});
