/**
 * `gift_voucher_unused` — what a voucher paid for that the client did not take (specs/gift-voucher-campaigns.md rule 15): an option the operator marked « non pris » in the arrival SAS.
 * Nothing is kept as a balance: the row says what it was and what it is worth at the day's prices, so the owner can offer a small gift in return.
 */

const iso = (date) => (date instanceof Date ? date.toISOString() : date);

function createUnusedModel(db, { now = () => new Date() } = {}) {
  const record = ({ voucherId, label, valueCents }) => Number(db.prepare('INSERT INTO gift_voucher_unused (voucherId, label, valueCents, at) VALUES (?, ?, ?, ?)')
    .run(Number(voucherId), String(label), Number(valueCents), iso(now())).lastInsertRowid);
  const listByVoucher = (voucherId) => db.prepare('SELECT * FROM gift_voucher_unused WHERE voucherId = ? ORDER BY id').all(Number(voucherId));
  const totalCents = (voucherId) => db.prepare('SELECT COALESCE(SUM(valueCents), 0) AS cents FROM gift_voucher_unused WHERE voucherId = ?').get(Number(voucherId)).cents;
  return { record, listByVoucher, totalCents };
}

module.exports = createUnusedModel;
