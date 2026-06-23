/**
 * Web Push fan-out (specs/pwa-push-notifications.md §3.3 + §3.4).
 *
 * `sendToPref(prefKey, payload)` pushes `payload` to every (user, device) subscription whose user has the
 * `prefKey` preference ON. `sendToUser(userId, payload)` pushes to all of one user's own devices,
 * ignoring preferences — used by the "send a test notification" action. Dead endpoints (404/410) are
 * pruned. The whole operation is fully isolated: it NEVER throws — a misconfigured VAPID, a missing
 * subscription, or a browser-endpoint error can't propagate to the caller (iCal sync / booking /
 * scheduled tick stay intact). This is a correctness guarantee, covered by tests.
 *
 * Injectable (`webpush` / `model` / `vapid` / `logger`) for unit tests.
 */

const realWebpush = require('web-push');
const realModel = require('../models/pushSubscriptionsModel');
const realVapid = require('./vapid');

function buildPushService({ webpush = realWebpush, model = realModel, vapid = realVapid, logger = console } = {}) {
  // Push `payload` (an object → JSON) to the given subscriptions. Prunes 404/410, counts transient
  // failures, never throws. Resolves to `{ sent, pruned, failed }`.
  async function sendToSubscriptions(subs, payload) {
    const body = JSON.stringify(payload || {});
    let sent = 0;
    let pruned = 0;
    let failed = 0;
    await Promise.all(subs.map(async (s) => {
      const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
      try {
        await webpush.sendNotification(subscription, body);
        sent += 1;
      } catch (err) {
        const code = err && (err.statusCode || err.status);
        if (code === 404 || code === 410) {
          try { model.removeByEndpoint(s.endpoint); pruned += 1; } catch { /* ignore */ }
        } else {
          failed += 1;
          // Include the push service's reason body — e.g. a `403 BadJwtToken` from Apple means the
          // VAPID JWT was rejected (an invalid `sub` subject, see vapid.js), which silently kills every
          // iOS push. Surfacing the reason makes that diagnosable from the logs.
          const reason = err && err.body ? String(err.body).replace(/\s+/g, ' ').slice(0, 200) : '';
          logger.warn('[pushService] send failed:', code || (err && err.message) || err, reason);
        }
      }
    }));
    return { sent, pruned, failed };
  }

  // Push `payload` to all subscriptions opted-in for `prefKey`. Resolves to
  // `{ sent, pruned, failed, skipped? }`; never rejects.
  async function sendToPref(prefKey, payload) {
    try {
      if (!vapid.isConfigured()) return { sent: 0, pruned: 0, failed: 0, skipped: 'no_vapid' };
      const subs = model.subscriptionsForPref(prefKey) || [];
      if (subs.length === 0) return { sent: 0, pruned: 0, failed: 0 };
      return await sendToSubscriptions(subs, payload);
    } catch (err) {
      logger.warn('[pushService] sendToPref error:', err && err.message ? err.message : err);
      return { sent: 0, pruned: 0, failed: 0, error: true };
    }
  }

  // Push `payload` to every device of a single user, regardless of preferences (used by the test-push
  // action). Resolves to `{ sent, pruned, failed, skipped? }`; never rejects.
  async function sendToUser(userId, payload) {
    try {
      if (!vapid.isConfigured()) return { sent: 0, pruned: 0, failed: 0, skipped: 'no_vapid' };
      const subs = model.listByUser(userId) || [];
      if (subs.length === 0) return { sent: 0, pruned: 0, failed: 0, skipped: 'no_subscription' };
      return await sendToSubscriptions(subs, payload);
    } catch (err) {
      logger.warn('[pushService] sendToUser error:', err && err.message ? err.message : err);
      return { sent: 0, pruned: 0, failed: 0, error: true };
    }
  }

  return { sendToPref, sendToUser };
}

const defaultService = buildPushService();
defaultService.buildPushService = buildPushService;

module.exports = defaultService;
