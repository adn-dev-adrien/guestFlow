// @ts-check
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { alias, gfRoot } from './shared.config.js';

export default defineConfig({
  plugins: [react({ include: /\.(jsx?|tsx?)$/ })],
  resolve: { alias },
  server: {
    port: 3200,
    strictPort: true,
    fs: { allow: [gfRoot] },
    // The browser's Host reaches the console unchanged (Vite's string form rewrites it), so the
    // same-origin gate of writes holds in development too (specs/control-plane-plans-and-access.md rule 36).
    proxy: {
      '/api': { target: 'http://localhost:4100', changeOrigin: false },
      '/exports': { target: 'http://localhost:4100', changeOrigin: false },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
