import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './push/registerPush';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

// PWA service worker for Web Push (specs/pwa-push-notifications.md). The SW is fetch-free (no request
// interception), so registration is inert for users who never enable notifications. Best-effort.
registerServiceWorker();
