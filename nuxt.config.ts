// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  colorMode: {
    fallback: 'dark',
    preference: 'system'
  },

  modules: ['@nuxt/eslint', '@nuxt/ui', '@nuxtjs/device'],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  compatibilityDate: '2025-01-15',

  runtimeConfig: {
    mailgunBaseUrl: process.env.NUXT_MAILGUN_BASE_URL || '',
    mailgunBcc: process.env.NUXT_MAILGUN_BCC || '',
    mailgunDomain: process.env.NUXT_MAILGUN_DOMAIN || '',
    mailgunKey: process.env.NUXT_MAILGUN_KEY || '',
    mailgunRecipient: process.env.NUXT_MAILGUN_RECIPIENT || '',
    mailgunSender: process.env.NUXT_MAILGUN_SENDER || '',
    public: {
      nodeEnv: process.env.NUXT_PUBLIC_NODE_ENV || 'development'
    }
  },

  typescript: {
    strict: true,
    typeCheck: true
  },
  ui: {
    colorMode: true
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
