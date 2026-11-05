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

  /** → { token, session }. The token leaves here once, for the cookie. */
  function create({ propertyId, reservationId = null, mode, origin, expiresAt, nameConfirmedAt = null, now }) {
    const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO guest_sessions (tokenHash, propertyId, reservationId, mode, origin, nameConfirmedAt, createdAt, lastSeenAt, expiresAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(hashToken(token), Number(propertyId), reservationId, mode, origin, iso(nameConfirmedAt), iso(now), iso(now), iso(expiresAt));
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

  function confirmName(id, now) {
    db.prepare('UPDATE guest_sessions SET nameConfirmedAt = ?, nameFailures = 0, nameLockedUntil = NULL WHERE id = ?')
      .run(iso(now), Number(id));
    return byId(id);
  }

  /** A wrong name: `lockedUntil` when this failure reached the limit, the count starting over after it. */
  function recordNameFailure(id, { locksAt, lockedUntil }) {
    const failures = byId(id).nameFailures + 1;
    const locked = failures >= locksAt;
    db.prepare('UPDATE guest_sessions SET nameFailures = ?, nameLockedUntil = ? WHERE id = ?')
      .run(locked ? 0 : failures, locked ? iso(lockedUntil) : null, Number(id));
    return byId(id);
  }

  /** Rule 4 data model — a session row goes 30 days after its expiry. */
  function purgeExpired(now) {
    const before = new Date(now.getTime() - PURGE_AFTER_DAYS * DAY_MS).toISOString();
    return db.prepare('DELETE FROM guest_sessions WHERE expiresAt < ?').run(before).changes;
  }

  return { confirmName, create, findByToken, hashToken, purgeExpired, recordNameFailure, touch };
}

module.exports = createSessionsModel;
module.exports.hashToken = hashToken;
