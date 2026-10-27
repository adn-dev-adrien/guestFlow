/**
 * Push subscriptions + per-user push preferences (specs/pwa-push-notifications.md §5).
 *
 * `push_subscriptions` holds one row per (user, device) browser subscription. `user_push_prefs` holds
 * the per-user toggles of the core channels (newReservation / arrivals / departures / breakfast);
 * `user_push_channel_prefs` those of the channels plugins declare (specs/platform-settings-relay-and-review.md
 * rule 8), one row per (user, channel). Every toggle defaults ON while the user has no row yet.
 *
 * Factory `create(db)` (+ a default bound to the production DB), mirroring the other models.
 */

const db = require('../database');

const PREF_KEYS = ['newReservation', 'arrivals', 'departures', 'breakfast'];
const DEFAULT_PREFS = { newReservation: true, arrivals: true, departures: true, breakfast: true };
// A plugin channel key, as `ctx.pushChannel` accepts it.
const CHANNEL_KEY = /^[a-z][a-z0-9-]{0,39}$/;
const isChannelKey = (key) => !PREF_KEYS.includes(key) && CHANNEL_KEY.test(String(key || ''));

function createPushSubscriptionsModel(database) {
  const stmts = {
    upsertSub: database.prepare(`
      INSERT INTO push_subscriptions (userId, endpoint, p256dh, auth)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET userId = excluded.userId, p256dh = excluded.p256dh, auth = excluded.auth
    `),
    removeByEndpoint: database.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?'),
    listByUser: database.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE userId = ? ORDER BY id'),
    readPrefs: database.prepare('SELECT newReservation, arrivals, departures, breakfast FROM user_push_prefs WHERE userId = ?'),
    upsertPrefs: database.prepare(`
      INSERT INTO user_push_prefs (userId, newReservation, arrivals, departures, breakfast)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(userId) DO UPDATE SET
        newReservation = excluded.newReservation, arrivals = excluded.arrivals, departures = excluded.departures, breakfast = excluded.breakfast
    `),
  };
  // Prepared on first use: a partial schema (unit tests of the core channels) has no channel table.
  const channelStmt = (() => {
    const cache = {};
    return (name, sql) => {
      if (!cache[name]) cache[name] = database.prepare(sql);
      return cache[name];
    };
  })();
  const readChannel = (userId, key) => {
    const row = channelStmt('read', 'SELECT enabled FROM user_push_channel_prefs WHERE userId = ? AND channel = ?').get(Number(userId), key);
    return row ? Number(row.enabled) !== 0 : true;
  };
  const writeChannel = (userId, key, on) => channelStmt('write', `
    INSERT INTO user_push_channel_prefs (userId, channel, enabled) VALUES (?, ?, ?)
    ON CONFLICT(userId, channel) DO UPDATE SET enabled = excluded.enabled
  `).run(Number(userId), key, on ? 1 : 0);

  // Subscriptions of every user whose `prefKey` preference is ON. A user with no prefs row defaults to
  // ON (LEFT JOIN + COALESCE), so opting-in a device is enough to start receiving by default.
  function subscriptionsForPref(prefKey) {
    if (isChannelKey(prefKey)) {
      if (!require('../utils/pushChannels').isDeclaredPushChannel(prefKey)) return [];
      return channelStmt('subs', `
        SELECT s.id, s.endpoint, s.p256dh, s.auth
        FROM push_subscriptions s
        LEFT JOIN user_push_channel_prefs c ON c.userId = s.userId AND c.channel = ?
        WHERE COALESCE(c.enabled, 1) = 1
        ORDER BY s.id
      `).all(prefKey);
    }
    if (!PREF_KEYS.includes(prefKey)) return [];
    const sql = `
      SELECT s.id, s.endpoint, s.p256dh, s.auth
      FROM push_subscriptions s
      LEFT JOIN user_push_prefs p ON p.userId = s.userId
      WHERE COALESCE(p.${prefKey}, 1) = 1
      ORDER BY s.id
    `;
    return database.prepare(sql).all();
  }

  return {
    PREF_KEYS,

    subscribe(userId, subscription) {
      const endpoint = subscription && subscription.endpoint;
      const keys = (subscription && subscription.keys) || {};
      if (!endpoint || !keys.p256dh || !keys.auth) return { error: 'INVALID_SUBSCRIPTION' };
      stmts.upsertSub.run(Number(userId), String(endpoint), String(keys.p256dh), String(keys.auth));
      return { ok: true };
    },

    unsubscribe(endpoint) {
      if (!endpoint) return { ok: true };
      stmts.removeByEndpoint.run(String(endpoint));
      return { ok: true };
    },

    // Remove a dead endpoint (push service returned 404/410). Idempotent.
    removeByEndpoint(endpoint) {
      if (endpoint) stmts.removeByEndpoint.run(String(endpoint));
    },

    listByUser(userId) {
      return stmts.listByUser.all(Number(userId));
    },

    subscriptionsForPref,

    // The core toggles, plus one per plugin channel named in `channelKeys` (the live ones).
    getPreferences(userId, channelKeys = []) {
      const row = stmts.readPrefs.get(Number(userId));
      const core = !row ? { ...DEFAULT_PREFS } : {
        newReservation: Number(row.newReservation) !== 0,
        arrivals: Number(row.arrivals) !== 0,
        departures: Number(row.departures) !== 0,
        breakfast: Number(row.breakfast) !== 0,
      };
      const channels = channelKeys.filter(isChannelKey);
      return { ...core, ...Object.fromEntries(channels.map((key) => [key, readChannel(userId, key)])) };
    },

    // Partial update: only the provided keys change; the rest keep their current (or default) value. A
    // plugin channel is written only when named in `channelKeys`.
    setPreferences(userId, patch = {}, channelKeys = []) {
      const current = this.getPreferences(userId, channelKeys);
      const next = { ...current };
      for (const k of Object.keys(current)) {
        if (patch[k] !== undefined) next[k] = Boolean(patch[k]);
      }
      stmts.upsertPrefs.run(Number(userId), next.newReservation ? 1 : 0, next.arrivals ? 1 : 0, next.departures ? 1 : 0, next.breakfast ? 1 : 0);
      channelKeys.filter(isChannelKey).forEach((key) => { if (patch[key] !== undefined) writeChannel(userId, key, next[key]); });
      return next;
    },
  };
}

const defaultModel = createPushSubscriptionsModel(db);
defaultModel.create = createPushSubscriptionsModel;
defaultModel.PREF_KEYS = PREF_KEYS;

module.exports = defaultModel;
