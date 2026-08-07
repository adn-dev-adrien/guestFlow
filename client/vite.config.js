// @ts-check
// Client build + dev server config — replaces react-scripts 5.0.1.
// Specs: specs/cra-to-vite-migration.md §3.1.
//
// Migration acceptance criterion (§7.1): the Playwright E2E suite from PR #110 must
// produce 18 passed / 1 skipped / 0 failed, identical to V02.01.00. Do NOT change the
// dev server port, proxy target or output dir without re-running the E2E suite.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    // GuestFlow's source uses `.js` files with JSX inside (CRA convention preserved).
    react({ include: /\.(jsx?|tsx?)$/ }),
  ],

  // No JSX-in-`.js` shim any more (specs/vite-8-oxc-migration.md): every file containing JSX is
  // named `.jsx` since Vite 8. Vite 8 replaced esbuild with oxc AND rollup with rolldown, and both
  // decide JSX purely by extension (`isJSX = filepath.endsWith("x")`). There is no configuration
  // escape hatch: `lang` is omitted from `OxcOptions`, and rolldown exposes none either — the old
  // `esbuild: { loader: 'jsx' }` block is silently ignored, and `oxc: false` doesn't help because
  // rolldown still parses the entry itself. Renaming was the only supported route.

  server: {
    // Match the previous CRA dev port so the E2E config + the dev workflow stay
    // unchanged.
    port: 3000,
    strictPort: true,
    // Equivalent of `client/package.json`'s previous `"proxy": "http://localhost:4000"`
    // field. Keeps /api/* same-origin from the browser's perspective so the session
    // cookie binds to localhost:3000 — same auth model the E2E suite expects.
    //
    // `/uploads` is also proxied: the backend serves `server/uploads/*` (company logo +
    // property photos) at that path (see server/src/index.js line 100). Under CRA the
    // `"proxy": "http://localhost:4000"` string was a catch-all that forwarded every
    // unmatched request to the backend — Vite requires explicit prefixes, so without this
    // entry the dev server returns 404 for every `<img src="/uploads/…">` and the dynamic
    // favicon stays at the bundled default.
    proxy: {
      '/api': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
    },
  },

  build: {
    // CRA wrote to client/build; Vite defaults to client/dist. The rename is wired
    // through release.sh + deploy.yml + README in this same PR.
    outDir: 'dist',
    // Never ship sourcemaps to prod — security flag pinned by the 2026-06-01 audit
    // (was `GENERATE_SOURCEMAP=false` in CRA / CI). Equivalent here.
    sourcemap: false,
    // Vite ships zero inline runtime scripts by default — already satisfies the
    // `script-src 'self'` CSP posture that `INLINE_RUNTIME_CHUNK=false` enforced
    // under CRA. No extra setting required.
  },

  define: {
    // Defensive shim for the rare transitive dep that touches `global.xxx`. Webpack
    // had this aliased; Vite leaves it as `undefined`, which crashes some libraries
    // on the very first import.
    global: 'globalThis',
  },
});
