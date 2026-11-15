/**
 * `gift_voucher_orders` — what was asked for and by whom (specs/gift-vouchers.md §5). The public token (rule 21) is 24
 * random bytes kept twice: its SHA-256 to find the order, and encrypted through the core helper because the voucher
 * link must be sent again. Never logged.
 */

const crypto = require('crypto');
const sdk = require('../../sdk');

const { encrypt, safeDecrypt } = sdk.coreModule('encryption');

const TOKEN_BYTES = 24;
const PENDING_KEPT_DAYS = 7;

const hashToken = (token) => crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
const iso = (date) => (date instanceof Date ? date.toISOString() : date);

function createOrdersModel(db, { now = () => new Date() } = {}) {
  /** → `{ id, token }`. */
  function create({
    amountCents, recipientName = '', senderName = '', message = '', email = '', language = 'fr', termsVersionId = null,
    termsAcceptedAt = null, visitorHash = null, source, paymentMethod = null, createdBy = 'public',
  }) {
    const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO gift_voucher_orders (publicTokenHash, publicTokenEncrypted, amountCents, recipientName, senderName, message, email,
        language, termsVersionId, termsAcceptedAt, visitorHash, source, paymentMethod, state, createdAt, createdBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(hashToken(token), encrypt(token), amountCents, recipientName, senderName, message, email, language, termsVersionId,
      termsAcceptedAt, visitorHash, source, paymentMethod, iso(now()), String(createdBy));
    return { id: Number(lastInsertRowid), token };
  }

  const find = (id) => db.prepare('SELECT * FROM gift_voucher_orders WHERE id = ?').get(Number(id)) || null;

  const markIssued = (id) => db.prepare("UPDATE gift_voucher_orders SET state = 'issued' WHERE id = ?").run(Number(id));

  /** The order's token, for a link the buyer asks again; null when the key changed and it no longer decrypts. */
  function tokenOf(id) {
    const row = db.prepare('SELECT publicTokenEncrypted FROM gift_voucher_orders WHERE id = ?').get(Number(id));
    const read = row && row.publicTokenEncrypted ? safeDecrypt(row.publicTokenEncrypted) : null;
    return read && read.ok && read.value ? read.value : null;
  }

  /** Rule 18 — an order never paid goes after 7 days. → the number deleted. */
  function purgeStalePending() {
    const cutoff = new Date(now().getTime() - PENDING_KEPT_DAYS * 24 * 60 * 60 * 1000).toISOString();
    return db.prepare("DELETE FROM gift_voucher_orders WHERE state = 'pending' AND createdAt < ?").run(cutoff).changes;
  }

  return {
    create, find, markIssued, tokenOf, purgeStalePending,
  };
}

module.exports = createOrdersModel;
