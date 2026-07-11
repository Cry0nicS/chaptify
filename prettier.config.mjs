/**
 * @type {import("prettier").Config}
 */
const config = {
  $schema: 'https://json.schemastore.org/prettierrc',
  arrowParens: 'always',
  bracketSameLine: true,
  bracketSpacing: true,
  endOfLine: 'lf',
  experimentalOperatorPosition: 'start',
  htmlWhitespaceSensitivity: 'ignore',
  insertPragma: false,
  jsxSingleQuote: false,
  printWidth: 100,
  proseWrap: 'preserve',
  quoteProps: 'consistent',
  requirePragma: false,
  semi: false,
  singleAttributePerLine: true,
  singleQuote: true,
  tabWidth: 2,
  trailingComma: 'none',
  useTabs: false,
  vueIndentScriptAndStyle: false,
  tailwindFunctions: ['tv', 'tw'],
  plugins: ['prettier-plugin-tailwindcss']
}

export default config
