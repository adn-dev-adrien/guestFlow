/**
 * `gift_vouchers` — one row per issued voucher (specs/gift-vouchers.md §5). Holds no balance: the sum of the movements is
 * the balance (rule 11), read here only to hand a row its figure. Money is written by `movementsModel`, nowhere else.
 */

const rules = require('../voucherRules');

const MONEY = rules.MONEY_KINDS.map((k) => `'${k}'`).join(', ');
const SEQUENCE_DIGITS = 4;

const SELECT = `
  SELECT v.*, o.recipientName, o.senderName, o.message, o.email, o.language, o.source, o.paymentMethod, o.createdBy,
    COALESCE((SELECT SUM(m.amountCents) FROM gift_voucher_movements m WHERE m.voucherId = v.id AND m.kind IN (${MONEY})), 0) AS balanceCents
  FROM gift_vouchers v JOIN gift_voucher_orders o ON o.id = v.orderId
`;

function createVouchersModel(db) {
  /** Rule 5 — `BC-<year>-<4 digits>`, the next of the year's sequence. Call inside the issuing transaction. */
  function nextNumber(year) {
    const prefix = `BC-${year}-`;
    const last = db.prepare('SELECT number FROM gift_vouchers WHERE number LIKE ? ORDER BY number DESC LIMIT 1').get(`${prefix}%`);
    const next = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
    if (next >= 10 ** SEQUENCE_DIGITS) throw Object.assign(new Error('VOUCHER_NUMBERS_EXHAUSTED'), { code: 'VOUCHER_NUMBERS_EXHAUSTED' });
    return `${prefix}${String(next).padStart(SEQUENCE_DIGITS, '0')}`;
  }

  const insert = ({
    orderId, number, codeHash, codeEncrypted, amountCents, issuedAt, expiresOn, vatRatePercent,
  }) => Number(db.prepare(`
    INSERT INTO gift_vouchers (orderId, number, codeHash, codeEncrypted, amountCents, issuedAt, expiresOn, vatRatePercent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(orderId, number, codeHash, codeEncrypted, amountCents, issuedAt, expiresOn, vatRatePercent).lastInsertRowid);

  const find = (id) => db.prepare(`${SELECT} WHERE v.id = ?`).get(Number(id)) || null;
  const findByCodeHash = (hash) => db.prepare(`${SELECT} WHERE v.codeHash = ?`).get(String(hash)) || null;
  const findByOrderId = (orderId) => db.prepare(`${SELECT} WHERE v.orderId = ?`).get(Number(orderId)) || null;
  /** Rule 23 — the vouchers sold on the site whose receipt has not left, issued between `since` and `before` (ISO instants). */
  const awaitingMail = ({ since, before }) => db.prepare(`${SELECT} WHERE o.source = 'site' AND o.email != '' AND v.mailSentAt IS NULL AND v.cancelledAt IS NULL
    AND v.issuedAt >= ? AND v.issuedAt <= ? ORDER BY v.id`).all(since, before);
  /** Rule 44 — the vouchers issued between two ISO instants, oldest first: the sales of a period of the books. */
  const issuedBetween = ({ since, before }) => db.prepare(`${SELECT} WHERE v.issuedAt >= ? AND v.issuedAt < ? ORDER BY v.issuedAt, v.id`).all(since, before);
  const listAll = () => db.prepare(`${SELECT} ORDER BY v.id DESC`).all();

  const setCancelled = (id, at) => db.prepare('UPDATE gift_vouchers SET cancelledAt = ? WHERE id = ? AND cancelledAt IS NULL').run(at, Number(id)).changes;
  const setExpiry = (id, expiresOn) => db.prepare('UPDATE gift_vouchers SET expiresOn = ? WHERE id = ?').run(expiresOn, Number(id));
  const setMail = (id, { sentAt = null, error = null }) => db.prepare('UPDATE gift_vouchers SET mailSentAt = ?, mailError = ? WHERE id = ?').run(sentAt, error, Number(id));

  const count = () => db.prepare('SELECT COUNT(*) AS n FROM gift_vouchers').get().n;
  const withBalance = () => db.prepare(`SELECT COUNT(*) AS n FROM (${SELECT}) WHERE balanceCents > 0`).get().n;

  return {
    nextNumber, insert, find, findByOrderId, awaitingMail, findByCodeHash, issuedBetween, listAll, setCancelled, setExpiry, setMail, count, withBalance,
  };
}

module.exports = createVouchersModel;
