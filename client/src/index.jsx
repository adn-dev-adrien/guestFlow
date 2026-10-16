import React from 'react';
import ReactDOM from 'react-dom/client';
// Self-hosted fonts (specs/ds-theme-maison.md §3.3) — the Pi deployment must render without internet.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/source-serif-4/600.css';
import '@fontsource/source-serif-4/700.css';
import { registerServiceWorker } from './push/registerPush';

// specs/plugins-phase-4-registry.md rule 18 — a production build imports each plugin's own bundle
// BEFORE the app modules evaluate, so the menus, routes and slots they compute see the plugins. The
// development server imports the plugin sources directly (rule 19).
const plugins = import.meta.env.PROD
  ? import('./plugins/runtime').then((runtime) => runtime.loadPluginBundles())
  : Promise.resolve();

const root = ReactDOM.createRoot(document.getElementById('root'));
plugins
  .catch(() => undefined)
  .then(() => import('./App'))
  .then(({ default: App }) => root.render(<App />));

// PWA service worker for Web Push (specs/pwa-push-notifications.md). The SW is fetch-free (no request
// interception), so registration is inert for users who never enable notifications. Best-effort.
registerServiceWorker();
