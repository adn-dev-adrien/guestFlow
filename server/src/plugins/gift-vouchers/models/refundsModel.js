/**
 * `gift_voucher_refunds` — the money a cancelled voucher owes back (specs/gift-voucher-campaigns.md rule 54). A line is opened with the cancellation, for the paid amount, and
 * stays « à rembourser » until the operator marks it settled once the transfer is made: GuestFlow itself transfers nothing.
 */

const iso = (date) => (date instanceof Date ? date.toISOString() : date);

function createRefundsModel(db, { now = () => new Date() } = {}) {
  const open = ({ voucherId, amountCents }) => Number(db.prepare('INSERT INTO gift_voucher_refunds (voucherId, amountCents, openedAt) VALUES (?, ?, ?)')
    .run(Number(voucherId), amountCents, iso(now())).lastInsertRowid);

  const find = (id) => db.prepare('SELECT * FROM gift_voucher_refunds WHERE id = ?').get(Number(id)) || null;
  const listByVoucher = (voucherId) => db.prepare('SELECT * FROM gift_voucher_refunds WHERE voucherId = ? ORDER BY id').all(Number(voucherId));

  /** → whether the line was open and is settled now. */
  const settle = (id, settledBy) => db.prepare('UPDATE gift_voucher_refunds SET settledAt = ?, settledBy = ? WHERE id = ? AND settledAt IS NULL')
    .run(iso(now()), String(settledBy), Number(id)).changes === 1;

  /** The lines opened between two ISO instants, oldest first: the refunds of a period of the books. */
  const openedBetween = ({ since, before }) => db.prepare('SELECT * FROM gift_voucher_refunds WHERE openedAt >= ? AND openedAt < ? ORDER BY openedAt, id').all(since, before);

  /** The lines still owed, for the list of vouchers. */
  const owed = () => db.prepare('SELECT * FROM gift_voucher_refunds WHERE settledAt IS NULL ORDER BY id').all();

  return {
    open, find, listByVoucher, settle, openedBetween, owed,
  };
}

module.exports = createRefundsModel;
