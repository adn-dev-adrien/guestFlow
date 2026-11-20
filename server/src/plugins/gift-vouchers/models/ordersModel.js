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
    amountCents, recipientName = '', senderName = '', message = '', email = '', language = 'fr', visitorHash = null, source, paymentMethod = null, createdBy = 'public', campaignId = null, contents = { kind: 'lodging' }, vatLines = null,
  }) {
    const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO gift_voucher_orders (publicTokenHash, publicTokenEncrypted, amountCents, recipientName, senderName, message, email,
        language, visitorHash, source, paymentMethod, state, createdAt, createdBy, campaignId, contents, vatLines)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, COALESCE(?, (SELECT id FROM gift_voucher_campaigns WHERE kind = 'lodging' AND oneShot = 0 ORDER BY id LIMIT 1)), ?, ?)
    `).run(hashToken(token), encrypt(token), amountCents, recipientName, senderName, message, email, language,
      visitorHash, source, paymentMethod, iso(now()), String(createdBy), campaignId, JSON.stringify(contents),
      vatLines ? JSON.stringify(vatLines) : null);
    return { id: Number(lastInsertRowid), token };
  }

  const find = (id) => db.prepare('SELECT * FROM gift_voucher_orders WHERE id = ?').get(Number(id)) || null;

  /** Rule 21 — the order behind `id` when `token` is its token, else null (a wrong token and an unknown id are the same answer). */
  function findByToken(id, token) {
    const order = find(id);
    if (!order || !order.publicTokenHash || typeof token !== 'string' || !token) return null;
    const given = Buffer.from(hashToken(token), 'hex');
    const stored = Buffer.from(order.publicTokenHash, 'hex');
    return given.length === stored.length && crypto.timingSafeEqual(given, stored) ? order : null;
  }

  const setLink = (id, linkId) => db.prepare('UPDATE gift_voucher_orders SET linkId = ? WHERE id = ?').run(Number(linkId), Number(id));

  /** Rule 15 — the orders a visitor started in the last `windowMs`. */
  const countSince = (visitorHash, windowMs) => db.prepare('SELECT COUNT(*) AS n FROM gift_voucher_orders WHERE visitorHash = ? AND createdAt >= ?')
    .get(String(visitorHash), new Date(now().getTime() - windowMs).toISOString()).n;

  /** Rule 19 — the order priced again at the moment of its payment link: the amount, the frozen contents and the VAT lines it will issue with. */
  const reprice = (id, { amountCents, contents, vatLines }) => db.prepare('UPDATE gift_voucher_orders SET amountCents = ?, contents = ?, vatLines = ? WHERE id = ? AND state = \'pending\'')
    .run(amountCents, JSON.stringify(contents), vatLines ? JSON.stringify(vatLines) : null, Number(id));

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
    const purged = db.prepare("DELETE FROM gift_voucher_orders WHERE state = 'pending' AND createdAt < ?").run(cutoff).changes;
    // A one-shot campaign is bound to its voucher (rule 46): the one of an order that never came to be goes with it.
    db.prepare(`DELETE FROM gift_voucher_campaigns WHERE oneShot = 1 AND id NOT IN (SELECT campaignId FROM gift_voucher_orders WHERE campaignId IS NOT NULL)
      AND id NOT IN (SELECT campaignId FROM gift_vouchers WHERE campaignId IS NOT NULL)`).run();
    return purged;
  }

  return {
    create, find, findByToken, setLink, countSince, reprice, markIssued, tokenOf, purgeStalePending,
  };
}

module.exports = createOrdersModel;
