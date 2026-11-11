/**
 * Password reset links (specs/hosting-h2-account-security.md rules 2, 4): only the SHA-256 of a
 * token is stored; a link works once, until its expiry; a new link voids the older ones. Also ends
 * every session of a user once their password was reset (rule 4).
 *
 * `buildModel(db)` for tests; the default instance is bound to the production database.
 */

function buildModel(db) {
  const voidOlderStmt = db.prepare('UPDATE password_reset_tokens SET usedAt = ? WHERE userId = ? AND usedAt IS NULL');
  const insertStmt = db.prepare('INSERT INTO password_reset_tokens (userId, tokenHash, expiresAt, createdAt) VALUES (?, ?, ?, ?)');
  const findStmt = db.prepare('SELECT * FROM password_reset_tokens WHERE tokenHash = ?');
  const useStmt = db.prepare('UPDATE password_reset_tokens SET usedAt = ? WHERE id = ? AND usedAt IS NULL AND expiresAt > ?');

  const hasSessions = () => Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").get());

  return {
    // A new link voids every link not used yet.
    create: db.transaction((userId, tokenHash, expiresAt, nowIso) => {
      voidOlderStmt.run(nowIso, Number(userId));
      insertStmt.run(Number(userId), tokenHash, expiresAt, nowIso);
    }),

    // The link if it can still be used, else null.
    findUsable(tokenHash, nowIso) {
      const row = findStmt.get(tokenHash);
      if (!row || row.usedAt || row.expiresAt <= nowIso) return null;
      return row;
    },

    // Spends the link; false when someone spent it first.
    consume(id, nowIso) {
      return useStmt.run(nowIso, Number(id), nowIso).changes === 1;
    },

    // Every session of the user — a logged-in one and one waiting for its second step.
    endSessionsOf(userId) {
      if (!hasSessions()) return 0;
      return db.prepare(`
        DELETE FROM sessions
        WHERE json_extract(sess, '$.user.id') = ? OR json_extract(sess, '$.pendingTwoFactor.userId') = ?
      `).run(Number(userId), Number(userId)).changes;
    },
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
