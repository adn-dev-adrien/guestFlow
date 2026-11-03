// specs/qonto-bank-reconciliation.md rules 2, 8–10 — what the fiches expect on the bank account, read
// from the core ledger.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, addReservation, TODAY, dayAt } = require('./reconciliationFixture');
const { expectedReceipts } = require('../reconciliation/expectedReceipts');
const { buildLedger } = require('../../../utils/reservationLedger');
const { parseGroup } = require('../../../utils/arrivalPaymentGroup');
const paymentLinks = require('../../../models/paymentLinksModel');

const receipts = (startDate = dayAt(-22)) => expectedReceipts({
  db, startDate, today: TODAY, buildLedger, parseGroup, listLinks: (id) => paymentLinks.listForReservation(id),
});
const of = (id) => receipts().filter((r) => r.reservationId === id);

test.beforeEach(() => {
  db.prepare('DELETE FROM payment_links WHERE reservationId >= 100').run();
  db.prepare('DELETE FROM reservations WHERE id >= 100').run();
});

test('rule 2 — cancelled stays and stays that left before the start date are out of scope', () => {
  const kept = addReservation({ endDate: dayAt(20) });
  addReservation({ endDate: dayAt(-23), startDate: dayAt(-25) });
  addReservation({ cancelledAt: `${dayAt(-22)} 10:00:00` });
  addReservation({ kind: 'devis' });
  assert.deepEqual([...new Set(receipts().filter((r) => r.reservationId >= 100).map((r) => r.reservationId))], [kept]);
});

test('rule 8 — a direct stay expects its deposit and its balance, amounts and dates from the ledger', () => {
  const id = addReservation({ depositAmount: 200, balanceAmount: 500, finalPrice: 700, depositDueDate: dayAt(-8), balanceDueDate: dayAt(13) });
  const rows = of(id);
  assert.deepEqual(rows.map((r) => [r.ledgerKey, r.expectedCents, r.dueDate, r.paid, r.channel]), [
    ['deposit', 20000, dayAt(-8), false, 'direct'],
    ['balance', 50000, dayAt(13), false, 'direct'],
  ]);
  assert.equal(rows[0].reservation.lastName, 'Dupont');
});

test('rule 8 — cash and caisse interne never reach the bank', () => {
  const id = addReservation({ depositAmount: 200, balanceAmount: 500, finalPrice: 700, depositPaid: 1, depositPaidCash: 1, depositPaidDate: dayAt(-13) });
  assert.deepEqual(of(id).map((r) => r.ledgerKey), ['balance']);
});

test('rule 8 — a paiement unique is one receipt for its total, dated at its collection', () => {
  const group = JSON.stringify({ at: dayAt(-3), cash: 0, total: 281.98, buckets: ['balance', 'complement'] });
  const id = addReservation({ balanceAmount: 231.98, finalPrice: 231.98, balancePaid: 1, balancePaidDate: dayAt(-3), complementAmount: 50, complementPaid: 1, complementPaidDate: dayAt(-3), arrivalPaymentGroup: group });
  const rows = of(id);
  assert.deepEqual(rows.map((r) => [r.ledgerKey, r.expectedCents, r.paidDate]), [['group', 28198, dayAt(-3)]]);
  const cash = addReservation({ balanceAmount: 231.98, finalPrice: 231.98, balancePaid: 1, complementAmount: 50, complementPaid: 1, arrivalPaymentGroup: JSON.stringify({ at: dayAt(-3), cash: 1, total: 281.98, buckets: ['balance', 'complement'] }) });
  assert.deepEqual(of(cash), [], 'a single payment into the caisse interne');
});

test('rule 9 — a platform stay expects ONE payout: the recorded transfer, else the gross', () => {
  const recorded = addReservation({ platform: 'Booking', balanceAmount: 710.02, finalPrice: 710.02, platformGrossAmount: 710.02, platformPayoutAmount: 596.58, balanceDueDate: dayAt(26) });
  const unrecorded = addReservation({ platform: 'Airbnb', balanceAmount: 300, finalPrice: 300, platformGrossAmount: 300, balanceDueDate: dayAt(26) });
  assert.deepEqual(of(recorded).map((r) => [r.channel, r.expectedCents, r.payoutRecorded]), [['platform:Booking', 59658, true]]);
  assert.deepEqual(of(unrecorded).map((r) => [r.channel, r.expectedCents, r.grossCents, r.payoutRecorded]), [['platform:Airbnb', 30000, 30000, false]]);
});

test('rule 9 — a received payout carries its recorded date; an unpriced platform fiche expects nothing', () => {
  const paid = addReservation({ platform: 'Booking', balanceAmount: 100, finalPrice: 100, platformPayoutAmount: 86.02, balancePaid: 1, balancePaidDate: dayAt(-5) });
  const empty = addReservation({ platform: 'Lodgify', finalPrice: 0, balanceAmount: 0 });
  assert.deepEqual(of(paid).map((r) => [r.paid, r.paidDate, r.expectedDate]), [[true, dayAt(-5), dayAt(-5)]]);
  assert.deepEqual(of(empty), []);
});

test('rule 9 — a stay settled by a payment link expects the link\'s date and the « link » channel', () => {
  const id = addReservation({ balanceAmount: 400, finalPrice: 400, balancePaid: 1, balancePaidDate: dayAt(-13) });
  db.prepare(`INSERT INTO payment_links (reservationId, type, providerLinkId, url, amountCents, currency, status, createdAt, paidAt)
    VALUES (?, 'full', 'ql_1', 'https://x', 40000, 'EUR', 'paid', '${dayAt(-14)} 10:00:00', '${dayAt(-13)}T09:00:00Z')`).run(id);
  const [r] = of(id);
  assert.equal(r.channel, 'link');
  assert.equal(r.linkPaidAt, dayAt(-13));
});

test('rule 8 — an échéance with nothing to collect is not an expected receipt', () => {
  const id = addReservation({ balanceAmount: 0, finalPrice: 0 });
  assert.deepEqual(of(id), []);
});
