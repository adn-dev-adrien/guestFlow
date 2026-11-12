// specs/pricing-components.md §3 rule 74 — the LIVE writers of `payment_allocations`: a stay paid, taken back, refunded or
// settled AFTER the boot has its allocations in the same transaction, with no help from the backfill. The proof is the table
// itself: after each move it equals what the stored columns describe (a rebuild writes nothing) and no stay is left marked.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, fiche, pay, forced, WITH_ACOMPTE, NO_ACOMPTE, S, C, D, TODAY, register, refund, giveAll,
} = require('./moneyLedgerFixture');
const { syncStay, flushDirty } = require('../utils/paymentAllocationsSync');

const rowsOf = (id, kind = 'payment') => db.prepare('SELECT paymentRef, lineRef, amountCents, books, origin, refundId FROM payment_allocations WHERE documentRef = ? AND kind = ? ORDER BY id').all(`reservation:${id}`, kind);
const sumOf = (id, ref) => rowsOf(id).filter((r) => r.paymentRef === ref).reduce((t, r) => t + r.amountCents, 0);
const cents = (n) => Math.round(Number(n) * 100);
const dirty = () => db.prepare('SELECT COUNT(*) AS n FROM payment_allocations_dirty').get().n;

// The invariant of every step: the rows are exactly what a rebuild from the stored columns writes, and nothing is marked.
function assertInStep(id, step) {
  assert.equal(dirty(), 0, `${step}: no stay left marked`);
  const before = db.prepare('SELECT paymentRef, lineRef, amountCents, kind, refundId FROM payment_allocations WHERE documentRef = ? ORDER BY paymentRef, lineRef, kind, refundId').all(`reservation:${id}`);
  assert.equal(syncStay(db, id), 0, `${step}: a rebuild changes nothing`);
  assert.deepEqual(db.prepare('SELECT paymentRef, lineRef, amountCents, kind, refundId FROM payment_allocations WHERE documentRef = ? ORDER BY paymentRef, lineRef, kind, refundId').all(`reservation:${id}`), before);
}

test('rule 74 — a balance ticked after the boot is allocated at once, and taking it back removes its rows', () => {
  const { id } = fiche(NO_ACOMPTE, 'direct');
  assert.deepEqual(rowsOf(id), [], 'an unpaid stay holds nothing');
  pay(id, S);
  const stay = db.prepare('SELECT balanceAmount FROM reservations WHERE id = ?').get(id);
  assert.equal(sumOf(id, 'bucket:balance'), cents(stay.balanceAmount), 'Σ allocations = the bucket');
  assert.ok(rowsOf(id).every((r) => r.origin === 'live' && r.books === 1));
  assertInStep(id, 'balance paid');
  pay(id, { balancePaid: false });
  assert.deepEqual(rowsOf(id), [], 'taken back, nothing left');
  assertInStep(id, 'balance taken back');
});

test('rule 74 — a cash complement is off the books; an acompte and a solde are separate payments', () => {
  const { id } = fiche(WITH_ACOMPTE, 'direct', { customOptions: [forced(50)] });
  pay(id, D, S, { ...C, complementPaidCash: true });
  const stay = db.prepare('SELECT depositAmount, balanceAmount, complementAmount FROM reservations WHERE id = ?').get(id);
  assert.equal(sumOf(id, 'bucket:deposit'), cents(stay.depositAmount));
  assert.equal(sumOf(id, 'bucket:balance'), cents(stay.balanceAmount));
  assert.ok(cents(stay.complementAmount) > 0);
  assert.equal(sumOf(id, 'bucket:complement'), cents(stay.complementAmount));
  assert.ok(rowsOf(id).filter((r) => r.paymentRef === 'bucket:complement').every((r) => r.books === 0), 'caisse interne');
  assertInStep(id, 'three buckets paid');
});

test('rule 74 — a refund is a negative allocation written with it and removed with it; the avoir of a requalification writes none', () => {
  const { id } = fiche(NO_ACOMPTE, 'direct');
  pay(id, S);
  giveAll(id);
  const refunds = rowsOf(id, 'refund');
  assert.ok(refunds.length > 0 && refunds.every((r) => r.amountCents < 0 && r.refundId != null && r.paymentRef === null));
  assertInStep(id, 'refunded');
  const refundId = db.prepare('SELECT id FROM reservation_refunds WHERE reservationId = ?').get(id).id;
  db.transaction(() => require('../models/refundsModel').remove(id, refundId))();
  assert.deepEqual(rowsOf(id, 'refund'), []);
  assertInStep(id, 'refund deleted');
});

test('rule 74 — a write nobody hooked marks the stay, and the reader\'s flush catches it up', () => {
  const { id } = fiche(NO_ACOMPTE, 'direct');
  db.prepare("UPDATE reservations SET balancePaid = 1, balancePaidDate = ? WHERE id = ?").run(TODAY, id);
  assert.equal(dirty() > 0, true, 'the trigger marked the stay');
  assert.equal(rowsOf(id).length, 0, 'not yet written');
  assert.equal(flushDirty(db, id), 1);
  assert.ok(sumOf(id, 'bucket:balance') > 0);
  assertInStep(id, 'raw statement');
});

test('rule 74 — an installment paid after the boot is allocated, its frozen split or its whole amount', () => {
  const { id } = fiche(NO_ACOMPTE, 'direct');
  const installments = require('../models/installmentsModel');
  installments.replacePlan(id, [{ number: 1, dueDate: TODAY, amountCents: 5000 }, { number: 2, dueDate: TODAY, amountCents: 7000 }], 12000);
  const first = installments.listFor(id)[0];
  installments.markPaid(first.id, { paidDate: TODAY, method: 'transfer' });
  assert.equal(sumOf(id, `installment:${first.id}`), 5000);
  assertInStep(id, 'installment paid');
  installments.markUnpaid(first.id);
  assert.equal(rowsOf(id).length, 0);
  assertInStep(id, 'installment taken back');
});

test('rule 74 — a refund through the register lands on the line it names', () => {
  const { id } = fiche(NO_ACOMPTE, 'direct');
  pay(id, S);
  const line = register(id).refundableLines.find((l) => l.refundableTtc > 0);
  const res = refund(id, [{ key: line.key, amountTtc: Math.min(1, line.refundableTtc) }]);
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  const stored = db.prepare('SELECT lineRef, source, revenueBucket, amountCents FROM reservation_refund_lines WHERE refundId = ?').all(res.body.refund.id);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].amountCents, 100);
  assert.ok(stored[0].source && stored[0].revenueBucket);
  const kind = db.prepare('SELECT kind, origin, amountCents FROM reservation_refunds WHERE id = ?').get(res.body.refund.id);
  assert.deepEqual(kind, { kind: 'refund', origin: 'operator', amountCents: 100 });
  assertInStep(id, 'line refund');
});
