// @ts-check
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { alias } from './shared.config.js';

export default defineConfig({
  plugins: [react({ include: /\.(jsx?|tsx?)$/ })],
  resolve: { alias },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.js'],
    watch: false,
  },
});
