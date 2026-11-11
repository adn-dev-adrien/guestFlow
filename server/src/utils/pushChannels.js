/**
 * The push notification toggles a user may set (specs/pwa-push-notifications.md §6,
 * specs/platform-settings-relay-and-review.md rule 8): the core's own, then those the live plugins
 * declared with `ctx.pushChannel({ key, label })`. Served with their French label, so the settings card
 * renders the list as is and the core never names a plugin.
 */

const registry = require('../plugins/sdk/registry');

const CORE_PUSH_CHANNELS = Object.freeze([
  { key: 'newReservation', label: 'Nouvelle réservation' },
  { key: 'arrivals', label: 'Arrivées' },
  { key: 'departures', label: 'Départs' },
  // Breakfast serving-time push (specs/sas-breakfast-bread-and-push.md rule 6).
  { key: 'breakfast', label: 'Petit déjeuner' },
]);

/** The channels of the live plugins. A plugin that goes inactive takes its toggle with it. */
function pluginPushChannels() {
  return registry.all()
    .filter((r) => (r.pushChannels || []).length > 0 && registry.isLive(r.id))
    .flatMap((r) => r.pushChannels.map((c) => ({ key: c.key, label: c.label })));
}

/** Declared by a plugin, live or not: a send names a channel someone can switch off. */
function isDeclaredPushChannel(key) {
  return registry.all().some((r) => (r.pushChannels || []).some((c) => c.key === key));
}

function availablePushChannels() {
  return [...CORE_PUSH_CHANNELS, ...pluginPushChannels()];
}

module.exports = { CORE_PUSH_CHANNELS, pluginPushChannels, availablePushChannels, isDeclaredPushChannel };
