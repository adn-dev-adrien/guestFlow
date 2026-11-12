// specs/pricing-components.md §3 rule 78 and specs/payment-schedule-and-cancellation.md — the figures of a cancellation are
// stored with it: `cancellationKeptCents` / `cancellationIndemnityCents` on the stay, the refunds the avoir netted in
// `refund_nettings`, the refund a received compensation paired with. The notice reads the column.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, fiche, pay, cancel, WITH_ACOMPTE, D, refund, register,
} = require('./moneyLedgerFixture');
const refundsModel = require('../models/refundsModel');
const { cancellationKeptForEmail } = require('../utils/cancellationKeptForEmail');

const stayOf = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);

test('rule 78 — the cancellation stores the sum kept and the indemnity, and the notice reads them', async () => {
  const { id } = fiche(WITH_ACOMPTE, 'direct');
  pay(id, D);
  await cancel(id);
  const stay = stayOf(id);
  const avoir = db.prepare("SELECT id, totalTtc, amountCents FROM reservation_refunds WHERE reservationId = ? AND method = 'retained'").get(id);
  assert.ok(avoir, 'the acompte kept is requalified');
  assert.equal(stay.cancellationIndemnityCents, avoir.amountCents);
  const entry = JSON.parse(db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = ? AND eventType = 'cancel' ORDER BY id DESC").get(id).changedFields);
  const keptInHistory = entry.find((c) => c.field === 'keptFromGuest').to;
  assert.equal(stay.cancellationKeptCents, Math.round(keptInHistory * 100));
  assert.equal(cancellationKeptForEmail(db, stay), keptInHistory);
  db.prepare('UPDATE reservations SET cancellationKeptCents = ? WHERE id = ?').run(1234, id);
  assert.equal(cancellationKeptForEmail(db, stayOf(id)), 12.34, 'the column is the source, not the history');
});

test('rule 78 — the avoir records the refunds it netted once, the deletion refusal reads them; the compensation names its refund', async () => {
  const { id } = fiche(WITH_ACOMPTE, 'direct');
  pay(id, D);
  const line = register(id).refundableLines.find((l) => l.refundableTtc > 1);
  assert.equal(refund(id, [{ key: line.key, amountTtc: 1 }]).statusCode, 201);
  const before = db.prepare('SELECT id FROM reservation_refunds WHERE reservationId = ?').all(id).map((r) => r.id);
  await cancel(id);
  const avoir = db.prepare("SELECT id FROM reservation_refunds WHERE reservationId = ? AND method = 'retained'").get(id);
  const netted = db.prepare('SELECT refundId FROM refund_nettings WHERE avoirId = ?').all(avoir.id).map((r) => r.refundId);
  assert.deepEqual(netted.filter((n) => !before.includes(n)), [], 'only refunds that existed before the avoir');
  assert.deepEqual([...refundsModel.nettedRefundIds(id)].sort(), netted.sort());
  const compensation = db.prepare('SELECT refundId FROM cancellation_compensations WHERE reservationId = ? ORDER BY id DESC').get(id);
  assert.equal(compensation.refundId, avoir.id);
  // Written once: no later read adds a row.
  const rows = db.prepare('SELECT COUNT(*) AS n FROM refund_nettings').get().n;
  refundsModel.nettedRefundIds(id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM refund_nettings').get().n, rows);
});

test('rule 78 — a stay without an avoir has no netting', () => {
  const { id } = fiche(WITH_ACOMPTE, 'direct');
  assert.equal(refundsModel.nettedRefundIds(id), null);
});
