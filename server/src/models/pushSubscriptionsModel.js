/**
 * Push subscriptions + per-user push preferences (specs/pwa-push-notifications.md §5).
 *
 * `push_subscriptions` holds one row per (user, device) browser subscription. `user_push_prefs` holds
 * the per-user toggles (newReservation / arrivals / departures / breakfast / neat), all defaulting ON when
 * the user has no row yet.
 *
 * Factory `create(db)` (+ a default bound to the production DB), mirroring the other models.
 */

const db = require('../database');

const PREF_KEYS = ['newReservation', 'arrivals', 'departures', 'breakfast', 'neat'];
const DEFAULT_PREFS = { newReservation: true, arrivals: true, departures: true, breakfast: true, neat: true };

function createPushSubscriptionsModel(database) {
  const stmts = {
    upsertSub: database.prepare(`
      INSERT INTO push_subscriptions (userId, endpoint, p256dh, auth)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET userId = excluded.userId, p256dh = excluded.p256dh, auth = excluded.auth
    `),
    removeByEndpoint: database.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?'),
    listByUser: database.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE userId = ? ORDER BY id'),
    readPrefs: database.prepare('SELECT newReservation, arrivals, departures, breakfast, neat FROM user_push_prefs WHERE userId = ?'),
    upsertPrefs: database.prepare(`
      INSERT INTO user_push_prefs (userId, newReservation, arrivals, departures, breakfast, neat)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(userId) DO UPDATE SET
        newReservation = excluded.newReservation, arrivals = excluded.arrivals, departures = excluded.departures, breakfast = excluded.breakfast, neat = excluded.neat
    `),
  };

  // Subscriptions of every user whose `prefKey` preference is ON. A user with no prefs row defaults to
  // ON (LEFT JOIN + COALESCE), so opting-in a device is enough to start receiving by default.
  function subscriptionsForPref(prefKey) {
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

    getPreferences(userId) {
      const row = stmts.readPrefs.get(Number(userId));
      if (!row) return { ...DEFAULT_PREFS };
      return {
        newReservation: Number(row.newReservation) !== 0,
        arrivals: Number(row.arrivals) !== 0,
        departures: Number(row.departures) !== 0,
        breakfast: Number(row.breakfast) !== 0,
        neat: Number(row.neat) !== 0,
      };
    },

    // Partial update: only the provided keys change; the rest keep their current (or default) value.
    setPreferences(userId, patch = {}) {
      const current = this.getPreferences(userId);
      const next = { ...current };
      for (const k of PREF_KEYS) {
        if (patch[k] !== undefined) next[k] = Boolean(patch[k]);
      }
      stmts.upsertPrefs.run(Number(userId), next.newReservation ? 1 : 0, next.arrivals ? 1 : 0, next.departures ? 1 : 0, next.breakfast ? 1 : 0, next.neat ? 1 : 0);
      return next;
    },
  };
}

const defaultModel = createPushSubscriptionsModel(db);
defaultModel.create = createPushSubscriptionsModel;
defaultModel.PREF_KEYS = PREF_KEYS;

module.exports = defaultModel;
