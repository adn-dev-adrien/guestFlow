// specs/pricing-components.md §3 rule 78 and reservation-refunds rule 6 — the refunds a requalification avoir netted are
// recorded once in `refund_nettings`, as `cancellationNettedRefundIds` reads them today (payment-schedule rule 55 reading).
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, WITH_ACOMPTE, S, D, fiche, pay, cancel, register, refund, giveAll,
} = require('./moneyLedgerFixture');
const { backfillRefundNettings } = require('../utils/pricingLinesMigration');
const { cancellationNettedRefundIds } = require('../utils/cancelReservation');
const reservationsModel = require('../models/reservationsModel');
const installmentsModel = require('../models/installmentsModel');
const refundsModel = require('../models/refundsModel').createModel(db);
const vatRegimeModel = require('../models/vatRegimeModel');

const nettedToday = (id) => {
  const stay = reservationsModel.getForCancellation(id);
  const refunds = refundsModel.listByReservation(id);
  return [...(cancellationNettedRefundIds({ database: db, reservationsModel, installmentsModel }, id, refunds, vatRegimeModel.rateForRow(db, stay)) || [])].sort();
};
const stored = (id) => db.prepare(`SELECT n.avoirId, n.refundId FROM refund_nettings n JOIN reservation_refunds r ON r.id = n.avoirId WHERE r.reservationId = ? ORDER BY n.refundId`).all(id);

test('rule 78: each refund a requalification avoir netted is recorded against it, as today\'s derivation names it', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  pay(stay.id, D);
  const line = register(stay.id).refundableLines.find((l) => l.refundableTtc > 0);
  assert.equal(refund(stay.id, [{ key: line.key, amountTtc: 100 }]).statusCode, 201, 'money of the acompte given back before the cancellation');
  await cancel(stay.id);
  const avoir = refundsModel.listByReservation(stay.id).find((r) => r.method === 'retained');
  assert.ok(avoir, 'the cancellation wrote its avoir');
  const expected = nettedToday(stay.id);
  assert.deepEqual(expected.length > 0, true, 'a book refund made before the cancellation changed what the avoir keeps');
  db.prepare('DELETE FROM refund_nettings').run();
  const written = backfillRefundNettings(db, { force: true });
  assert.equal(written, expected.length);
  assert.deepEqual(stored(stay.id), expected.map((refundId) => ({ avoirId: avoir.id, refundId: Number(refundId) })));
});

test('rule 78: the backfill runs once and a second run writes nothing, a forced one rewrites no row', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  pay(stay.id, D, S);
  giveAll(stay.id);
  await cancel(stay.id);
  db.prepare('DELETE FROM refund_nettings').run();
  db.prepare("DELETE FROM migrations WHERE name = 'pricing_refund_nettings_v1'").run();
  backfillRefundNettings(db);
  const once = db.prepare('SELECT COUNT(*) AS n FROM refund_nettings').get().n;
  assert.equal(backfillRefundNettings(db), 0, 'marked as done');
  assert.equal(backfillRefundNettings(db, { force: true }), 0, 'forced, the same rows are already there');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM refund_nettings').get().n, once);
});

test('rule 78: a stay without an avoir has no netting, and a minimal schema is left alone', () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  assert.deepEqual(stored(stay.id), []);
  const Database = require('better-sqlite3');
  assert.equal(backfillRefundNettings(new Database(':memory:'), { force: true }), 0);
});
