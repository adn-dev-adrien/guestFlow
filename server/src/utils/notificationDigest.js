/**
 * Grouping of operator notifications by time window (specs/public-request-abuse-and-grouping.md
 * rule 9). Generic: a `key` names one stream of events (`site-devis` today).
 *
 *   admit({ refId, kind }) → { immediate: true }   the first event of a window: notify now
 *                          → { immediate: false }  a later one: kept for the window's summary
 *   takeDue()              → [{ key, items, ids }]  the summaries whose window has ended, marked as
 *                                                    being sent (another flush skips them)
 *   settle(ids, sent)      → sent: the rows go; not sent: they wait for the next flush. A summary
 *                            left marked for 10 minutes (a crash mid-send) is handed out again.
 *
 * The state lives in the database (notification_digest_windows / _items), so a restart neither loses
 * a pending summary nor sends it twice. Nothing here sends anything: the caller does, best effort.
 */

const realDb = require('../database');

const STALE_TAKE_MS = 10 * 60 * 1000;

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
    const at = new Date(now()).toISOString();
    const staleBefore = new Date(now() - STALE_TAKE_MS).toISOString();
    const free = '(takenAt IS NULL OR takenAt < ?)';
    const keys = db.prepare(`SELECT DISTINCT digestKey FROM notification_digest_items WHERE ${free}`).all(staleBefore).map((r) => r.digestKey);
    keys.forEach((key) => {
      const window = db.prepare('SELECT windowStartedAt FROM notification_digest_windows WHERE digestKey = ?').get(key);
      if (window && !elapsed(window.windowStartedAt)) return;
      const items = db.prepare(`SELECT id, refId, kind, createdAt FROM notification_digest_items WHERE digestKey = ? AND ${free} ORDER BY id`).all(key, staleBefore);
      if (!items.length) return;
      const ids = items.map((i) => i.id);
      db.prepare(`UPDATE notification_digest_items SET takenAt = ? WHERE id IN (${ids.map(() => '?').join(',')})`).run(at, ...ids);
      out.push({ key, items, ids });
    });
    return out;
  });

  function settle(ids, sent) {
    if (!ids || !ids.length) return;
    const list = ids.map(() => '?').join(',');
    if (sent) db.prepare(`DELETE FROM notification_digest_items WHERE id IN (${list})`).run(...ids);
    else db.prepare(`UPDATE notification_digest_items SET takenAt = NULL WHERE id IN (${list})`).run(...ids);
  }

  return {
    admit: ({ key, refId, kind }) => admitTx(String(key), refId, kind),
    takeDue: () => takeTx(),
    settle,
  };
}

module.exports = { buildNotificationDigest };
