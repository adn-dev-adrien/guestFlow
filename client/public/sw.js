/* GuestFlow service worker — Web Push only (specs/pwa-push-notifications.md §4.2).
 *
 * Deliberately has NO `fetch` handler: it never intercepts requests, so it cannot change how the app
 * loads or behaves. It only shows push notifications and handles clicks. Keeping it fetch-free is what
 * makes adding the SW safe for every user (push-enabled or not). */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data && typeof event.data.text === 'function' ? event.data.text() : '' };
  }
  const title = data.title || 'GuestFlow';
  const options = {
    body: data.body || '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: data.tag || undefined,
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const win of wins) {
      // Reuse an open GuestFlow tab when possible.
      if ('focus' in win) {
        try { if ('navigate' in win) await win.navigate(url); } catch (e) { /* cross-origin / unsupported */ }
        return win.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
    return undefined;
  })());
});
