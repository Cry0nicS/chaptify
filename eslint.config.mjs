// @ts-check
import antfu from "@antfu/eslint-config";
import withNuxt from "./.nuxt/eslint.config.mjs";

export default withNuxt(
  antfu(
    {
      stylistic: false,
      typescript: true,
      vue: true,
      lessOpinionated: true,
      jsonc: true,
      ignores: ["public/**", "tsconfig.json"]
    },
    {
      files: ["**/*.vue"],
      rules: {
        "vue/html-indent": ["error", 4],
        "vue/object-curly-spacing": ["error", "never"],
        "vue/html-closing-bracket-newline": [
          "error",
          {
            singleline: "never",
            multiline: "never"
          }
        ],
        "vue/html-self-closing": "off",
        // Does not work with Prettier.
        // See: https://prettier.io/blog/2018/11/07/1.15.0#whitespace-sensitive-formatting.
        "vue/singleline-html-element-content-newline": "off",
        "vue/multiline-html-element-content-newline": "off"
      }
    },
    {
      rules: {
        "node/prefer-global/process": ["error", "always"]
      }
    },
    {
      rules: {
        "ts/consistent-type-definitions": "off",
        "ts/no-explicit-any": "error"
      }
    },
    {
      rules: {
        "unicorn/filename-case": [
          "error",
          {
            case: "kebabCase",
            ignore: ["^README\\.md$"]
          }
        ]
      }
    },
    {
      // Disable jsonc/sort-keys for package.json
      files: ["package.json"],
      rules: {
        "jsonc/sort-keys": "off"
      }
    }
  )
);
