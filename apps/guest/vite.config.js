// The guest app « Mon séjour » (specs/guest-app.md §4.2). Built to `dist/`, served by the guest-app plugin on
// the guest host; in development the API is GuestFlow's own server on :4000.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { manifest: true, target: 'es2020', sourcemap: false },
  server: {
    port: 5175,
    proxy: {
      '/public/v1/guest': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.js'],
    css: false,
    restoreMocks: true,
  },
});
