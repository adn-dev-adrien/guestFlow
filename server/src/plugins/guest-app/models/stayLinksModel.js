/**
 * `guest_stay_links` — one link per stay (specs/guest-app.md rule 1). The token is 128 random bits, base64url.
 * It is kept twice: its SHA-256 to find the link a guest opens, and encrypted through the core helper because
 * the SAS, the e-mails and the fiche must show it again. Never logged.
 *
 * At most one live row per reservation (a partial unique index): regenerating revokes the live row and
 * inserts a new one, so the old link and every session opened from it die at once.
 */

const crypto = require('crypto');
const sdk = require('../../sdk');

const { encrypt, safeDecrypt } = sdk.coreModule('encryption');

const TOKEN_BYTES = 16;

const hashToken = (token) => crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
const iso = (date) => (date instanceof Date ? date.toISOString() : date);

function createStayLinksModel(db) {
  const liveRow = (reservationId) => db.prepare('SELECT * FROM guest_stay_links WHERE reservationId = ? AND revokedAt IS NULL')
    .get(Number(reservationId)) || null;

  function insert(reservationId, now) {
    const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO guest_stay_links (reservationId, tokenEncrypted, tokenHash, createdAt) VALUES (?, ?, ?, ?)
    `).run(Number(reservationId), encrypt(token), hashToken(token), iso(now));
    return { id: Number(lastInsertRowid), token, createdAt: iso(now) };
  }

  const revoke = (id, now) => db.prepare('UPDATE guest_stay_links SET revokedAt = ? WHERE id = ? AND revokedAt IS NULL')
    .run(iso(now), Number(id));

  /**
   * The stay's live link, created the first time it is needed. A row whose token no longer decrypts (the
   * key changed) cannot be shown again: it is revoked and replaced, like a regeneration.
   */
  const ensure = (reservationId, now) => db.transaction(() => {
    const row = liveRow(reservationId);
    if (row) {
      const read = safeDecrypt(row.tokenEncrypted);
      if (read.ok && read.value) return { id: row.id, token: read.value, createdAt: row.createdAt };
      revoke(row.id, now);
    }
    return insert(reservationId, now);
  })();

  /** « Régénérer le lien » — the old link answers like an unknown one from now on. */
  const regenerate = (reservationId, now) => db.transaction(() => {
    const row = liveRow(reservationId);
    if (row) revoke(row.id, now);
    return insert(reservationId, now);
  })();

  /** The live link a guest opened → { id, reservationId }, or null for a guessed, stale or revoked token. */
  function findLiveByToken(token) {
    if (!token) return null;
    const row = db.prepare('SELECT id, reservationId FROM guest_stay_links WHERE tokenHash = ? AND revokedAt IS NULL')
      .get(hashToken(token));
    return row || null;
  }

  const isLive = (id) => Boolean(db.prepare('SELECT 1 FROM guest_stay_links WHERE id = ? AND revokedAt IS NULL').get(Number(id)));

  /** Whether the stay's client has an address the reminder e-mails can reach (rule 9bis b). */
  const clientHasEmail = (reservationId) => Boolean(db.prepare(`
    SELECT 1 FROM reservations r JOIN clients c ON c.id = r.clientId WHERE r.id = ? AND TRIM(COALESCE(c.email, '')) <> ''
  `).get(Number(reservationId)));

  return {
    clientHasEmail, ensure, findLiveByToken, isLive, regenerate,
  };
}

module.exports = createStayLinksModel;
module.exports.hashToken = hashToken;
