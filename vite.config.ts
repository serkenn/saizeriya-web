import { defineConfig } from 'vite-plus'

const ignoredPaths = ['packages/server/assets/**', '**/.svelte-kit/**', '**/build/**', '**/dist/**']

export default defineConfig({
  fmt: {
    ignorePatterns: ignoredPaths,
    semi: false,
    singleQuote: true,
  },
  lint: {
    ignorePatterns: ignoredPaths,
  },
})
