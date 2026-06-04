// @ts-check
// Vitest config — replaces `react-scripts test`.
// Specs: specs/cra-to-vite-migration.md §3.2.
//
// Kept separate from vite.config.js so each tool's concerns stay narrowly scoped.
// All 19 existing test files (src/**/__tests__/*.test.js) continue to use the global
// `describe / it / expect` shape thanks to `test.globals = true` below — no per-file
// rewrite needed.

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Same JSX-in-.js extension as vite.config.js — Vitest reuses the Vite transform pipeline.
  plugins: [react({ include: /\.(jsx?|tsx?)$/ })],
  esbuild: {
    loader: 'jsx',
    include: /src\/.*\.jsx?$/,
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: { '.js': 'jsx' },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // Loads `@testing-library/jest-dom` matchers (toBeInTheDocument, etc.) so the
    // existing tests don't need an `import '@testing-library/jest-dom'` at the top.
    setupFiles: ['./src/setupTests.js'],
    // Single-run mode in CI; honor --watch from the CLI for local dev.
    watch: false,
  },
});
