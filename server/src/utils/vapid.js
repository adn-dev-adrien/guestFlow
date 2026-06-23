/**
 * VAPID keys for Web Push (specs/pwa-push-notifications.md §3.4 rule 11).
 *
 * The keypair is generated once on first boot and persisted to `server/.env.local`
 * (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`) — same pattern as the session secret. It is git-ignored and
 * never committed. The PUBLIC key is exposed to the client (for the push subscription); the PRIVATE key
 * stays server-side and configures `web-push`.
 *
 * `ensureVapid()` is idempotent + safe to call at boot. `getPublicKey()` returns '' when not configured
 * (e.g. a test env that didn't init), so the client can degrade gracefully.
 */

const webpush = require('web-push');
const { loadLocalEnv, persistVar } = require('./localEnv');

// Contact required by the Web Push spec for the VAPID `sub` claim. It MUST be a routable URL/mailto:
// Apple's push gateway rejects the JWT with `403 BadJwtToken` when the subject is a non-routable domain
// (e.g. a `.local` TLD), which silently kills every iOS push. Override per-deployment via VAPID_SUBJECT
// in `.env.local` (git-ignored) if a specific contact address is preferred.
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:contact@domainesolio.com';

let configured = false;

function ensureVapid() {
  loadLocalEnv();
  let publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
  let privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
  if (!publicKey || !privateKey) {
    const keys = webpush.generateVAPIDKeys();
    publicKey = persistVar('VAPID_PUBLIC_KEY', keys.publicKey);
    privateKey = persistVar('VAPID_PRIVATE_KEY', keys.privateKey);
  }
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, publicKey, privateKey);
    configured = true;
  } catch {
    configured = false;
  }
  return { publicKey, configured };
}

function getPublicKey() {
  return (process.env.VAPID_PUBLIC_KEY || '').trim();
}

function isConfigured() {
  return configured && Boolean(getPublicKey());
}

module.exports = { ensureVapid, getPublicKey, isConfigured, VAPID_SUBJECT };
