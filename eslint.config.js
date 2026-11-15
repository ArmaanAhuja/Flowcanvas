// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    '**/dist/',
    '**/storybook-static/',
    '**/coverage/',
    '**/.turbo/',
    '**/.wrangler/',
    // Playwright output: reports bundle the trace viewer's own JavaScript.
    '**/playwright-report/',
    '**/playwright-report-visual/',
    '**/test-results/',
    '**/report-site/',
    '**/reports-data/',
    'docs/reference/',
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
]);
