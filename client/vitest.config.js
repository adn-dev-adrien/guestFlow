// @ts-check
// Vitest config — replaces `react-scripts test`.
// Specs: specs/tech/vite-8-oxc-migration.md.
//
// Kept separate from vite.config.js so each tool's concerns stay narrowly scoped.
// All 19 existing test files (src/**/__tests__/*.test.js) continue to use the global
// `describe / it / expect` shape thanks to `test.globals = true` below — no per-file
// rewrite needed.

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Vitest reuses the Vite transform pipeline, so this config MUST stay in step with vite.config.js
  // — including the absence of any JSX-in-`.js` shim: since Vite 8 every JSX-bearing file is named
  // `.jsx` (specs/tech/vite-8-oxc-migration.md).
  plugins: [react({ include: /\.(jsx?|tsx?)$/ })],
  test: {
    environment: 'jsdom',
    globals: true,
    // Loads `@testing-library/jest-dom` matchers (toBeInTheDocument, etc.) so the
    // existing tests don't need an `import '@testing-library/jest-dom'` at the top.
    // specs/plugins/plugins-phase-1-sdk.md rule 54 (loop t22 A22-1), specs/tech/server-test-isolation.md rule 23 — the SDK sale blocks' code
    // arrives late in every suite, as in the browser.
    setupFiles: ['./src/setupTests.js', './src/setupLateSaleChunks.js'],
    // specs/tech/server-test-isolation.md rule 17 — one budget for every test on a loaded runner, instead of Vitest's 5 s
    // default and per-file overrides; `setupTests.js` gives Testing Library's waits their share of it.
    testTimeout: 30000,
    // specs/tech/server-test-isolation.md rule 21 — every mock goes back to its own `vi.fn(impl)` before each test, "once"
    // answers included: an implementation one test set never answers the next one's call.
    mockReset: true,
    // Single-run mode in CI; honor --watch from the CLI for local dev.
    watch: false,
  },
});
