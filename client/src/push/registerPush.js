/**
 * Client-side Web Push helpers (specs/pwa-push-notifications.md §4.2).
 *
 * Registers the (fetch-free) service worker, and enables/disables the device subscription against the
 * server. All functions degrade gracefully when the browser doesn't support push (older Safari, http
 * non-localhost, etc.) — `pushSupported()` guards the UI.
 */
import api from '../api';

const SW_URL = '/sw.js';

// Convert the server's URL-safe base64 VAPID public key to the Uint8Array PushManager expects.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported() {
  return typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && typeof window !== 'undefined'
    && 'PushManager' in window
    && 'Notification' in window;
}

// Register the SW on app load. Safe no-op when unsupported; never throws.
export async function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(SW_URL);
  } catch {
    return null;
  }
}

// Current device state for the settings UI.
export async function getPushState() {
  if (!pushSupported()) return { supported: false, enabled: false, permission: 'unsupported' };
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return { supported: true, enabled: Boolean(sub), permission: Notification.permission };
}

// Request permission, subscribe this device, and register it server-side. Throws a French Error on the
// user-facing failure modes (unsupported / denied / server not configured) so the UI can show it.
export async function enablePush() {
  if (!pushSupported()) throw new Error("Ce navigateur ne supporte pas les notifications push.");
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error("Permission de notification refusée.");
  const reg = await navigator.serviceWorker.register(SW_URL);
  await navigator.serviceWorker.ready;
  const { publicKey, configured } = await api.getPushPublicKey();
  if (!configured || !publicKey) throw new Error("Notifications non configurées côté serveur.");
  const existing = await reg.pushManager.getSubscription();
  const sub = existing || await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await api.subscribePush(sub.toJSON());
  return true;
}

// Unsubscribe this device + drop it server-side. Never throws.
export async function disablePush() {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return true;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      try { await api.unsubscribePush(sub.endpoint); } catch { /* server prune is best-effort */ }
      await sub.unsubscribe();
    }
  } catch { /* ignore */ }
  return true;
}
