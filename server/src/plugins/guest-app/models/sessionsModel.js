/**
 * `guest_sessions` — a session is a stay capability (specs/guest-app.md rules 4, 9). The cookie holds 32
 * random bytes; only their SHA-256 is stored, so a stolen backup opens nothing.
 */

const crypto = require('crypto');

const TOKEN_BYTES = 32;
const DAY_MS = 24 * 60 * 60 * 1000;
const PURGE_AFTER_DAYS = 30;

const hashToken = (token) => crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
const iso = (date) => (date instanceof Date ? date.toISOString() : date);

function createSessionsModel(db) {
  const byId = (id) => db.prepare('SELECT * FROM guest_sessions WHERE id = ?').get(Number(id)) || null;

  /**
   * → { token, session }. The token leaves here once, for the cookie. `origin`: 'link' (a stay link,
   * `stayLinkId` set), 'poster' (a lodging code) or 'lookup' (rule 6).
   */
  function create({ propertyId, reservationId = null, mode, origin, stayLinkId = null, expiresAt, now }) {
    const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO guest_sessions (tokenHash, propertyId, reservationId, mode, origin, stayLinkId, createdAt, lastSeenAt, expiresAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(hashToken(token), Number(propertyId), reservationId, mode, origin, stayLinkId, iso(now), iso(now), iso(expiresAt));
    return { token, session: byId(lastInsertRowid) };
  }

  function findByToken(token) {
    if (!token) return null;
    return db.prepare('SELECT * FROM guest_sessions WHERE tokenHash = ?').get(hashToken(token)) || null;
  }

  /** The mode and the expiry follow the live reservation (the « dates changed » edge case). */
  function touch(id, { mode, expiresAt, now }) {
    db.prepare('UPDATE guest_sessions SET mode = ?, expiresAt = ?, lastSeenAt = ? WHERE id = ?')
      .run(mode, iso(expiresAt), iso(now), Number(id));
    return byId(id);
  }

  /** D28, rule 54 — « Régénérer le lien » also ends every session the lookup opened on that stay. */
  function endLookupSessions(reservationId) {
    return db.prepare("DELETE FROM guest_sessions WHERE reservationId = ? AND origin = 'lookup'").run(Number(reservationId)).changes;
  }

  /** Rule 4 data model — a session row goes 30 days after its expiry. */
  function purgeExpired(now) {
    const before = new Date(now.getTime() - PURGE_AFTER_DAYS * DAY_MS).toISOString();
    return db.prepare('DELETE FROM guest_sessions WHERE expiresAt < ?').run(before).changes;
  }

  return {
    create, endLookupSessions, findByToken, hashToken, purgeExpired, touch,
  };
}

module.exports = createSessionsModel;
module.exports.hashToken = hashToken;
