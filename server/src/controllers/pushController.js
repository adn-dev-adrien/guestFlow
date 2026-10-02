/**
 * Push controller (specs/pwa-push-notifications.md §4.3). All handlers are scoped to the logged-in
 * user (`req.user`, set by requireAuth). Thin: delegates to pushSubscriptionsModel + vapid.
 */

const model = require('../models/pushSubscriptionsModel');
const vapid = require('../utils/vapid');
const pushService = require('../utils/pushService');
const registry = require('../plugins/sdk/registry');
const PLUGINS = require('../constants/plugins');

// specs/plugins-phase-3b-neat.md rule 13 — the toggles a user can set: a plugin's channel only while
// that plugin is live. A stored preference is kept as it is either way.
const PLUGIN_CHANNELS = { neat: PLUGINS.NEAT };
function withAvailable(prefs) {
  const available = Object.keys(prefs).filter((key) => !PLUGIN_CHANNELS[key] || registry.isLive(PLUGIN_CHANNELS[key]));
  return { ...prefs, available };
}

function getPublicKey(req, res) {
  res.json({ publicKey: vapid.getPublicKey(), configured: vapid.isConfigured() });
}

function subscribe(req, res) {
  const userId = req.user && req.user.id;
  if (!userId) return res.status(401).json({ error: 'NOT_AUTHENTICATED' });
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
  return res.json(withAvailable(model.getPreferences(userId)));
}

function updatePreferences(req, res) {
  const userId = req.user && req.user.id;
  if (!userId) return res.status(401).json({ error: 'NOT_AUTHENTICATED' });
  return res.json(withAvailable(model.setPreferences(userId, req.body || {})));
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
