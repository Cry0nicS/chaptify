/**
 * @type {import("prettier").Config}
 */
const config = {
    $schema: "https://json.schemastore.org/prettierrc",
    arrowParens: "always",
    bracketSameLine: true,
    bracketSpacing: false,
    endOfLine: "lf",
    htmlWhitespaceSensitivity: "ignore",
    insertPragma: false,
    jsxSingleQuote: false,
    printWidth: 100,
    proseWrap: "preserve",
    quoteProps: "consistent",
    requirePragma: false,
    semi: true,
    singleAttributePerLine: true,
    singleQuote: false,
    tabWidth: 4,
    trailingComma: "none",
    useTabs: false,
    vueIndentScriptAndStyle: false,
    tailwindFunctions: ["tv", "tw"],
    plugins: ["prettier-plugin-tailwindcss"]
};

export default config;
