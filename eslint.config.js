import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {files: ["src/**/*.{js,mjs,cjs,ts}"]},
  {languageOptions: { globals: globals.browser }},
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'indent': ['error', 2],
      'semi': ['error', 'always'],
      'quotes': ['error', 'single', { 'avoidEscape': true }],
    }
  }
];
