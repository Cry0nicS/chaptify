// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  rules: {
    'vue/html-closing-bracket-newline': 'off',
    '@stylistic/operator-linebreak': 'off',
    'vue/singleline-html-element-content-newline': 'off',
    'nuxt/nuxt-config-keys-order': 'off'
  }
})
