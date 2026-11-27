/**
 * `guest_demo_links` — the one demo link of the instance (specs/guest-app/guest-app-demo-mode.md rule 1). Kept like a stay link: the
 * token is 128 random bits, base64url, stored as its SHA-256 (to find the link a phone opens) and encrypted through the core helper
 * (the Studio shows it again). Never logged. At most one live row: regenerating revokes it and inserts a new one, so the old link
 * and every session opened from it die at once.
 */

const crypto = require('crypto');
const sdk = require('../../sdk');

const { encrypt, safeDecrypt } = sdk.coreModule('encryption');

const TOKEN_BYTES = 16;

const hashToken = (token) => crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
const iso = (date) => (date instanceof Date ? date.toISOString() : date);

function createDemoLinkModel(db) {
  const liveRow = () => db.prepare('SELECT * FROM guest_demo_links WHERE revokedAt IS NULL ORDER BY id DESC LIMIT 1').get() || null;

  function insert(now) {
    const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
    const { lastInsertRowid } = db.prepare('INSERT INTO guest_demo_links (tokenEncrypted, tokenHash, createdAt) VALUES (?, ?, ?)')
      .run(encrypt(token), hashToken(token), iso(now));
    return { id: Number(lastInsertRowid), token, createdAt: iso(now) };
  }

  const revoke = (id, now) => db.prepare('UPDATE guest_demo_links SET revokedAt = ? WHERE id = ? AND revokedAt IS NULL').run(iso(now), Number(id));

  /** The live link, created the first time it is needed; a row whose token no longer decrypts is revoked and replaced. */
  const ensure = (now) => db.transaction(() => {
    const row = liveRow();
    if (row) {
      const read = safeDecrypt(row.tokenEncrypted);
      if (read.ok && read.value) return { id: row.id, token: read.value, createdAt: row.createdAt };
      revoke(row.id, now);
    }
    return insert(now);
  })();

  /** « Régénérer le lien » → { link, revokedId }: the old link answers like an unknown one from now on. */
  const regenerate = (now) => db.transaction(() => {
    const row = liveRow();
    if (row) revoke(row.id, now);
    return { link: insert(now), revokedId: row ? row.id : null };
  })();

  /** The live link a phone opened → { id }, or null for a guessed, stale or revoked token. */
  function findLiveByToken(token) {
    if (!token) return null;
    return db.prepare('SELECT id FROM guest_demo_links WHERE tokenHash = ? AND revokedAt IS NULL').get(hashToken(token)) || null;
  }

  const isLive = (id) => Boolean(db.prepare('SELECT 1 FROM guest_demo_links WHERE id = ? AND revokedAt IS NULL').get(Number(id)));

  return {
    ensure, findLiveByToken, isLive, regenerate,
  };
}

module.exports = createDemoLinkModel;
module.exports.hashToken = hashToken;
