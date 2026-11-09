// The guest app « Mon séjour » (specs/guest-app.md §4.2). Built to `dist/`, served by the guest-app plugin on
// the guest host; in development the API is GuestFlow's own server on :4000.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `GUEST_API` points the dev proxy at another GuestFlow server (a test harness, a shadow copy).
const API = process.env.GUEST_API || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  build: { manifest: true, target: 'es2020', sourcemap: false },
  server: {
    port: 5175,
    proxy: {
      '/public/v1/guest': API,
      '/uploads': API,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.js'],
    css: false,
    restoreMocks: true,
  },
});
