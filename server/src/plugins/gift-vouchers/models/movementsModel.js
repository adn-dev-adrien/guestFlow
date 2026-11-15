/**
 * `gift_voucher_movements` — the ledger (specs/gift-vouchers.md rule 31). The only writer of a voucher's money: rows are
 * appended, never updated or deleted (the migration's triggers refuse both), and the balance is always their sum
 * (rule 11). Every append is one `BEGIN IMMEDIATE` transaction that re-reads the balance, so two requests racing for
 * the same voucher cannot both take the last cents; the idempotency key makes a replay a no-op.
 */

const rules = require('../voucherRules');

const MONEY = rules.MONEY_KINDS.map((k) => `'${k}'`).join(', ');
const iso = (date) => (date instanceof Date ? date.toISOString() : date);

const refused = (code) => Object.assign(new Error(code), { code });

function createMovementsModel(db, { now = () => new Date() } = {}) {
  const balanceOf = (voucherId) => db.prepare(
    `SELECT COALESCE(SUM(amountCents), 0) AS cents FROM gift_voucher_movements WHERE voucherId = ? AND kind IN (${MONEY})`,
  ).get(Number(voucherId)).cents;

  const list = (voucherId) => db.prepare('SELECT * FROM gift_voucher_movements WHERE voucherId = ? ORDER BY id').all(Number(voucherId));

  const hasKind = (voucherId, kind) => Boolean(db.prepare('SELECT 1 FROM gift_voucher_movements WHERE voucherId = ? AND kind = ? LIMIT 1').get(Number(voucherId), kind));

  const byKey = (key) => db.prepare('SELECT * FROM gift_voucher_movements WHERE idempotencyKey = ?').get(String(key)) || null;

  /** → `{ movement, replayed }`; throws an error whose `code` is the refusal of `rules.movementRefusal`. */
  const append = db.transaction(({
    voucherId, kind, amountCents = 0, actor, note = null, idempotencyKey, reservationId = null, devisId = null,
  }) => {
    if (!idempotencyKey || !actor) throw refused('MOVEMENT_INCOMPLETE');
    const existing = byKey(idempotencyKey);
    if (existing) return { movement: existing, replayed: true };
    const voucher = db.prepare('SELECT amountCents FROM gift_vouchers WHERE id = ?').get(Number(voucherId));
    if (!voucher) throw refused('VOUCHER_NOT_FOUND');
    const refusal = rules.movementRefusal({
      kind, amountCents, balanceCents: balanceOf(voucherId), issuedCents: voucher.amountCents,
    });
    if (refusal) throw refused(refusal);
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO gift_voucher_movements (voucherId, kind, amountCents, reservationId, devisId, actor, note, idempotencyKey, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(Number(voucherId), kind, amountCents, reservationId, devisId, String(actor), note, String(idempotencyKey), iso(now()));
    return { movement: db.prepare('SELECT * FROM gift_voucher_movements WHERE id = ?').get(lastInsertRowid), replayed: false };
  }).immediate;

  return {
    append, balanceOf, list, hasKind, byKey,
  };
}

module.exports = createMovementsModel;
