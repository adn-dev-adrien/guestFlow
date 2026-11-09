// The booklet studio (specs/guest-app.md rules 47-50, §4.2). Built to `dist/`, served by the guest-app plugin at
// `/studio/` on the admin host; in development the API is GuestFlow's own server on :4000.
//
// Two pages: `index.html` (the studio, GuestFlow « Maison ») and `preview.html` (the phone preview, the guest app's
// own components and styles, isolated in an iframe so neither app's CSS reaches the other — rule 49).
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Where the two apps whose code the studio reads live. If the apps move (e.g. under the plugin's folder), these two
// lines are the only ones to change.
const GUESTFLOW_CLIENT = fileURLToPath(new URL('../../../../../../client/src', import.meta.url));
const GUEST_APP = fileURLToPath(new URL('../guest', import.meta.url));

// `STUDIO_API` points the dev proxy at another GuestFlow server.
const API = process.env.STUDIO_API || 'http://localhost:4000';

// GuestFlow's shared components and the guest app's renderers import these: one copy, the studio's own.
const SHARED = ['react', 'react-dom', 'react-router', '@mui/material', '@mui/system', '@mui/icons-material', '@emotion/react', '@emotion/styled', 'lucide-react'];

export default defineConfig({
  base: '/studio/',
  plugins: [react()],
  resolve: {
    alias: {
      '@guestflow': GUESTFLOW_CLIENT,
      '@guest': `${GUEST_APP}/src`,
      '@guest-public': `${GUEST_APP}/public`,
    },
    dedupe: SHARED,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      input: {
        studio: fileURLToPath(new URL('./index.html', import.meta.url)),
        preview: fileURLToPath(new URL('./preview.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 5176,
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
    proxy: {
      '/api': API,
      '/uploads': API,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.js'],
    css: false,
    restoreMocks: true,
    server: { deps: { inline: [/client\/src/, /apps\/guest/] } },
  },
});
