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
