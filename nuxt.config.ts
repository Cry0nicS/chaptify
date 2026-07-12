export default defineNuxtConfig({
    compatibilityDate: "2025-01-15",

    eslint: {
        config: {
            standalone: false // <--- Required for Antfu ESLint config.
        }
    },

    modules: ["@nuxt/eslint", "@nuxt/ui", "@nuxtjs/device"],

    devtools: {
        enabled: true
    },

    css: ["~/assets/css/main.css"],

    runtimeConfig: {
        appBaseUrl: "http://localhost:3000",
        storageRoot: "",
        maxUploadBytes: "1073741824",
        maxQueuedJobs: "10",
        workerConcurrency: "1",
        jobRetentionHours: "12",
        emailRetryAttempts: "3",
        mailgunBaseUrl: process.env.NUXT_MAILGUN_BASE_URL || "",
        mailgunDomain: process.env.NUXT_MAILGUN_DOMAIN || "",
        mailgunKey: process.env.NUXT_MAILGUN_KEY || "",
        mailgunSender: process.env.NUXT_MAILGUN_SENDER || "",
        mailgunRecipient: process.env.NUXT_MAILGUN_RECIPIENT || "",
        mailgunBcc: process.env.NUXT_MAILGUN_BCC || "",
        public: {
            nodeEnv: process.env.NUXT_PUBLIC_NODE_ENV || "development"
        }
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
