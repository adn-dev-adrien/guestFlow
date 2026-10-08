/**
 * Support access with consent (specs/hosting-h2-account-security.md rules 12–16): the requests and
 * their decision, the sign-in links already used, and the log of what the support did.
 *
 * An access is **pending** until an administrator decides, **open** once accepted and until it
 * expires or is revoked. There is at most one pending request: a new one replaces its reason.
 *
 * `buildModel(db)` for tests; the default instance is bound to the production database.
 */

function buildModel(db) {
  const byIdStmt = db.prepare('SELECT * FROM support_access WHERE id = ?');
  const byRequestStmt = db.prepare('SELECT * FROM support_access WHERE requestId = ?');
  const pendingStmt = db.prepare('SELECT * FROM support_access WHERE decision IS NULL ORDER BY id DESC LIMIT 1');
  const insertStmt = db.prepare('INSERT INTO support_access (requestId, reason, requestedAt) VALUES (?, ?, ?)');
  const replaceStmt = db.prepare('UPDATE support_access SET requestId = ?, reason = ?, requestedAt = ? WHERE id = ?');
  const decideStmt = db.prepare('UPDATE support_access SET decision = ?, decidedBy = ?, decidedAt = ?, expiresAt = ? WHERE id = ? AND decision IS NULL');
  const revokeStmt = db.prepare('UPDATE support_access SET revokedAt = ?, revokedBy = ? WHERE id = ? AND revokedAt IS NULL');
  const openStmt = db.prepare(`SELECT * FROM support_access WHERE decision = 'accepted' AND revokedAt IS NULL AND expiresAt > ?
    ORDER BY expiresAt DESC LIMIT 1`);
  const listStmt = db.prepare(`
    SELECT a.*, TRIM(COALESCE(d.firstName, '') || ' ' || COALESCE(d.lastName, '')) AS decidedByName, d.email AS decidedByEmail,
           TRIM(COALESCE(r.firstName, '') || ' ' || COALESCE(r.lastName, '')) AS revokedByName, r.email AS revokedByEmail,
           (SELECT COUNT(*) FROM support_access_log l WHERE l.accessId = a.id) AS logCount
    FROM support_access a
    LEFT JOIN users d ON d.id = a.decidedBy
    LEFT JOIN users r ON r.id = a.revokedBy
    ORDER BY a.requestedAt DESC, a.id DESC
    LIMIT 50
  `);
  const useLinkStmt = db.prepare('INSERT OR IGNORE INTO support_access_links (jti, accessId, usedAt) VALUES (?, ?, ?)');
  const addLogStmt = db.prepare('INSERT INTO support_access_log (accessId, at, method, path, summary) VALUES (?, ?, ?, ?, ?)');
  const logsStmt = db.prepare('SELECT at, method, path, summary FROM support_access_log WHERE accessId = ? ORDER BY at DESC, id DESC LIMIT 500');

  return {
    get: (id) => byIdStmt.get(Number(id)) || null,
    pending: () => pendingStmt.get() || null,
    open: (nowIso) => openStmt.get(nowIso) || null,
    list: () => listStmt.all(),

    // A request read from the console's file. One already known (decided or pending) changes nothing;
    // a new one replaces the pending reason (§3 « Two requests in a row »). → the pending row or null.
    receiveRequest: db.transaction(({ requestId, reason, requestedAt }) => {
      if (byRequestStmt.get(requestId)) return pendingStmt.get() || null;
      const pending = pendingStmt.get();
      if (pending) replaceStmt.run(requestId, reason, requestedAt, pending.id);
      else insertStmt.run(requestId, reason, requestedAt);
      return pendingStmt.get();
    }),

    // false when the request was already decided.
    decide: (id, { decision, userId, nowIso, expiresAt }) => decideStmt.run(decision, Number(userId), nowIso, expiresAt || null, Number(id)).changes === 1,
    revoke: (id, userId, nowIso) => revokeStmt.run(nowIso, Number(userId), Number(id)).changes === 1,

    // A sign-in link works once: false when its `jti` was already used.
    useLink: (jti, accessId, nowIso) => useLinkStmt.run(String(jti), Number(accessId), nowIso).changes === 1,

    addLog: (accessId, { at, method, path, summary }) => addLogStmt.run(Number(accessId), at, method, path, summary || ''),
    logs: (accessId) => logsStmt.all(Number(accessId)),
  };
}

let defaultModel = null;
module.exports = {
  buildModel,
  get default() {
    if (!defaultModel) defaultModel = buildModel(require('../database'));
    return defaultModel;
  },
};
