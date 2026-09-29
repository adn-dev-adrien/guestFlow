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
    proxy: {
      '/api': 'http://localhost:4100',
      '/exports': 'http://localhost:4100',
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
