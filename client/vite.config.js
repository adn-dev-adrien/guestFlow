// @ts-check
// Client build + dev server config — replaces react-scripts 5.0.1.
// Specs: specs/cra-to-vite-migration.md §3.1.
//
// Migration acceptance criterion (§7.1): the Playwright E2E suite from PR #110 must
// produce 18 passed / 1 skipped / 0 failed, identical to V02.01.00. Do NOT change the
// dev server port, proxy target or output dir without re-running the E2E suite.

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const STATIC_PLUGIN_LIST = fileURLToPath(new URL('./src/plugins/index.js', import.meta.url));
const RUNTIME_PLUGIN_LIST = fileURLToPath(new URL('./src/plugins/runtimeModules.js', import.meta.url));

// specs/plugins-phase-4-registry.md rule 18, P27 — a production build ships no plugin code: every
// import of the static module list (`src/plugins/index.js`, which imports the twelve source folders)
// is redirected to the list `src/plugins/runtime.js` fills from each plugin's own bundle. The dev
// server and the unit suites keep the static list (rule 19).
function pluginRuntimeList() {
  return {
    name: 'guestflow-plugin-runtime-list',
    apply: 'build',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !source.startsWith('.')) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved && resolved.id === STATIC_PLUGIN_LIST ? RUNTIME_PLUGIN_LIST : null;
    },
  };
}

// Review M3 — a production build imports `App` only once the plugin bundles are loaded (rule 18), so
// the browser would fetch the App chunks late. These links fetch them (without evaluating them) in
// parallel with the bundles, and the list of bundles too.
function preloadApp() {
  return {
    name: 'guestflow-preload-app',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html;
        const chunks = Object.values(ctx.bundle).filter((c) => c.type === 'chunk');
        const app = chunks.find((c) => c.facadeModuleId && /\/src\/App\.jsx$/.test(c.facadeModuleId));
        if (!app) return html;
        const byName = Object.fromEntries(chunks.map((c) => [c.fileName, c]));
        const files = new Set();
        const visit = (name) => {
          if (files.has(name) || !byName[name]) return;
          files.add(name);
          byName[name].imports.forEach(visit);
        };
        visit(app.fileName);
        return [
          { tag: 'link', attrs: { rel: 'preload', href: '/plugin-assets/entries.json', as: 'fetch', crossorigin: 'anonymous' }, injectTo: 'head' },
          ...[...files].map((f) => ({ tag: 'link', attrs: { rel: 'modulepreload', href: `/${f}`, crossorigin: true }, injectTo: 'head' })),
        ];
      },
    },
  };
}

export default defineConfig({
  plugins: [
    pluginRuntimeList(),
    preloadApp(),
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
    // GUESTFLOW_API_PORT lets the E2E suite run its own backend beside a dev server on 4000.
    proxy: {
      '/api': `http://localhost:${process.env.GUESTFLOW_API_PORT || 4000}`,
      '/uploads': `http://localhost:${process.env.GUESTFLOW_API_PORT || 4000}`,
      '/plugin-assets': `http://localhost:${process.env.GUESTFLOW_API_PORT || 4000}`,
    },
  },

  build: {
    // CRA wrote to client/build; Vite defaults to client/dist. The rename is wired
    // through release.sh + deploy.yml + README in this same PR.
    outDir: 'dist',
    // Never ship sourcemaps to prod — security flag pinned by the 2026-06-01 audit
    // (was `GENERATE_SOURCEMAP=false` in CRA / CI). Equivalent here.
    sourcemap: false,
    // specs/inte-performance.md rule 4 — scripts/check-bundle-budget.mjs reads the chunk graph from it.
    manifest: true,
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
