import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App';
import { device } from './services/device';
import './styles.css';

// Rule 52 — the install card waits for the second visit.
device.set('visits', (Number(device.get('visits')) || 0) + 1);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// Rule 21 — the service worker keeps the shell and the booklet for the domain's weak coverage. Once it
// controls the page, it is handed what this first load already fetched, so the shell works offline at once.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then((reg) => {
      const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.startsWith(window.location.origin));
      if (reg.active) reg.active.postMessage({ type: 'warm', urls: [window.location.origin + '/', ...urls] });
    }).catch(() => {});
  });
}
