/**
 * Push controller (specs/pwa-push-notifications.md §4.3). All handlers are scoped to the logged-in
 * user (`req.user`, set by requireAuth). Thin: delegates to pushSubscriptionsModel + vapid.
 */

const model = require('../models/pushSubscriptionsModel');
const vapid = require('../utils/vapid');
const pushService = require('../utils/pushService');
const { availablePushChannels, pluginPushChannels } = require('../utils/pushChannels');

// specs/plugins-phase-3b-neat.md rule 13, specs/platform-settings-relay-and-review.md rule 8 — the
// toggles a user can set: the core's, then each live plugin's own, served with its label. A stored
// preference of an inactive plugin is kept as it is.
const pluginKeys = () => pluginPushChannels().map((c) => c.key);
function withAvailable(prefs) {
  const channels = availablePushChannels();
  return { ...prefs, available: channels.map((c) => c.key), channels };
}

function getPublicKey(req, res) {
  res.json({ publicKey: vapid.getPublicKey(), configured: vapid.isConfigured() });
}

function subscribe(req, res) {
  const userId = req.user && req.user.id;
  if (!userId) return res.status(401).json({ error: 'NOT_AUTHENTICATED' });
  if (req.user.isSupport) return res.status(403).json({ error: 'SUPPORT_FORBIDDEN', message: 'Action réservée au compte du client.' });
  const result = model.subscribe(userId, req.body && req.body.subscription);
  if (result.error) return res.status(400).json({ error: result.error });
  return res.json({ ok: true });
}

function unsubscribe(req, res) {
  model.unsubscribe(req.body && req.body.endpoint);
  return res.json({ ok: true });
}

function getPreferences(req, res) {
  const userId = req.user && req.user.id;
  if (!userId) return res.status(401).json({ error: 'NOT_AUTHENTICATED' });
  return res.json(withAvailable(model.getPreferences(userId, pluginKeys())));
}

function updatePreferences(req, res) {
  const userId = req.user && req.user.id;
  if (!userId) return res.status(401).json({ error: 'NOT_AUTHENTICATED' });
  return res.json(withAvailable(model.setPreferences(userId, req.body || {}, pluginKeys())));
}

// Send a test push to every device of the current user (ignores preferences). Returns the fan-out
// result `{ sent, pruned, failed, skipped? }` so the UI can confirm delivery or surface a failure.
async function sendTest(req, res) {
  const userId = req.user && req.user.id;
  if (!userId) return res.status(401).json({ error: 'NOT_AUTHENTICATED' });
  const result = await pushService.sendToUser(userId, {
    title: 'GuestFlow',
    body: 'Notification de test ✓ Tout fonctionne.',
    url: '/settings',
    tag: 'guestflow-test',
  });
  return res.json(result);
}

module.exports = { getPublicKey, subscribe, unsubscribe, getPreferences, updatePreferences, sendTest };
