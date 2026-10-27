/**
 * Grouping of operator notifications by time window (specs/public-request-abuse-and-grouping.md
 * rule 9). Generic: a `key` names one stream of events (`site-devis` today).
 *
 *   admit({ refId, kind }) → { immediate: true }   the first event of a window: notify now
 *                          → { immediate: false }  a later one: kept for the window's summary
 *   takeDue()              → [{ key, items }]       the summaries whose window has ended, removed
 *                                                    from the store as they are handed out
 *
 * The state lives in the database (notification_digest_windows / _items), so a restart neither loses
 * a pending summary nor sends it twice. Nothing here sends anything: the caller does, best effort.
 */

const realDb = require('../database');

function buildNotificationDigest({ db = realDb, windowMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
  const elapsed = (startedAt) => now() - Date.parse(startedAt) >= windowMs;

  const admitTx = db.transaction((key, refId, kind) => {
    const at = new Date(now()).toISOString();
    const window = db.prepare('SELECT windowStartedAt FROM notification_digest_windows WHERE digestKey = ?').get(key);
    if (!window || elapsed(window.windowStartedAt)) {
      db.prepare(`INSERT INTO notification_digest_windows (digestKey, windowStartedAt) VALUES (?, ?)
        ON CONFLICT(digestKey) DO UPDATE SET windowStartedAt = excluded.windowStartedAt`).run(key, at);
      return { immediate: true };
    }
    db.prepare('INSERT INTO notification_digest_items (digestKey, refId, kind, createdAt) VALUES (?, ?, ?, ?)')
      .run(key, refId == null ? null : Number(refId), String(kind || ''), at);
    return { immediate: false };
  });

  const takeTx = db.transaction(() => {
    const out = [];
    const keys = db.prepare('SELECT DISTINCT digestKey FROM notification_digest_items').all().map((r) => r.digestKey);
    keys.forEach((key) => {
      const window = db.prepare('SELECT windowStartedAt FROM notification_digest_windows WHERE digestKey = ?').get(key);
      if (window && !elapsed(window.windowStartedAt)) return;
      const items = db.prepare('SELECT refId, kind, createdAt FROM notification_digest_items WHERE digestKey = ? ORDER BY id').all(key);
      db.prepare('DELETE FROM notification_digest_items WHERE digestKey = ?').run(key);
      if (items.length) out.push({ key, items });
    });
    return out;
  });

  return {
    admit: ({ key, refId, kind }) => admitTx(String(key), refId, kind),
    takeDue: () => takeTx(),
  };
}

module.exports = { buildNotificationDigest };
