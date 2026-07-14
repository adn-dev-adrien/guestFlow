import React from 'react';
import ReactDOM from 'react-dom/client';
// Self-hosted fonts (specs/ds-theme-maison.md §3.3) — the Pi deployment must render without internet.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/source-serif-4/600.css';
import '@fontsource/source-serif-4/700.css';
import App from './App';
import { registerServiceWorker } from './push/registerPush';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

// PWA service worker for Web Push (specs/pwa-push-notifications.md). The SW is fetch-free (no request
// interception), so registration is inert for users who never enable notifications. Best-effort.
registerServiceWorker();
