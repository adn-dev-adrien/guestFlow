/**
 * Web Push fan-out (specs/pwa-push-notifications.md §3.3 + §3.4).
 *
 * `sendToPref(prefKey, payload)` pushes `payload` to every (user, device) subscription whose user has the
 * `prefKey` preference ON. Dead endpoints (404/410) are pruned. The whole operation is fully isolated: it
 * NEVER throws — a misconfigured VAPID, a missing subscription, or a browser-endpoint error can't
 * propagate to the caller (iCal sync / booking / scheduled tick stay intact). This is a correctness
 * guarantee, covered by tests.
 *
 * Injectable (`webpush` / `model` / `vapid` / `logger`) for unit tests.
 */

const realWebpush = require('web-push');
const realModel = require('../models/pushSubscriptionsModel');
const realVapid = require('./vapid');

function buildPushService({ webpush = realWebpush, model = realModel, vapid = realVapid, logger = console } = {}) {
  // Push `payload` (an object → JSON) to all subscriptions opted-in for `prefKey`. Resolves to
  // `{ sent, pruned, skipped? }`; never rejects.
  async function sendToPref(prefKey, payload) {
    try {
      if (!vapid.isConfigured()) return { sent: 0, pruned: 0, skipped: 'no_vapid' };
      const subs = model.subscriptionsForPref(prefKey) || [];
      if (subs.length === 0) return { sent: 0, pruned: 0 };
      const body = JSON.stringify(payload || {});
      let sent = 0;
      let pruned = 0;
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
            logger.warn('[pushService] send failed:', code || (err && err.message) || err);
          }
        }
      }));
      return { sent, pruned };
    } catch (err) {
      logger.warn('[pushService] sendToPref error:', err && err.message ? err.message : err);
      return { sent: 0, pruned: 0, error: true };
    }
  }

  return { sendToPref };
}

const defaultService = buildPushService();
defaultService.buildPushService = buildPushService;

module.exports = defaultService;
