// specs/mixed-method-payments.md rule 28 — the bank expects of a split payment only its card, cheque and transfer
// lines, one receipt per settlement; the bucket it paid is not expected a second time.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, addReservation, TODAY, dayAt } = require('./reconciliationFixture');
const { expectedReceipts } = require('../reconciliation/expectedReceipts');
const { buildLedger } = require('../../../utils/reservationLedger');
const { parseGroup } = require('../../../utils/arrivalPaymentGroup');
const paymentLinks = require('../../../models/paymentLinksModel');
const settlements = require('../../../models/paymentSettlementsModel');

const of = (id) => expectedReceipts({
  db, startDate: dayAt(-22), today: TODAY, buildLedger, parseGroup, listLinks: (rid) => paymentLinks.listForReservation(rid),
}).filter((r) => r.reservationId === id);

test.beforeEach(() => {
  db.prepare('DELETE FROM payment_settlements WHERE reservationId >= 100').run();
  db.prepare('DELETE FROM reservations WHERE id >= 100').run();
});

test('rule 28 — 50 € cash + 72 € card: the bank expects 72 €, once', () => {
  const id = addReservation({ depositAmount: 0, balanceAmount: 0, finalPrice: 500, endOfStayComplementAmount: 122,
    endOfStayComplementPaid: 1, endOfStayComplementPaidDate: dayAt(-1) });
  settlements.insert({
    reservationId: id, targetKind: 'bucket', targetKey: 'endOfStayComplement', paidDate: dayAt(-1), dueCents: 12200,
    parts: [{ kind: 'endOfStayComplement', key: 'endOfStayComplement', amountCents: 12200 }],
    lines: [{ method: 'cash', amountCents: 5000, internal: true }, { method: 'card', amountCents: 7200, internal: false }],
  });
  const receipts = of(id);
  assert.deepEqual(receipts.map((r) => [r.ledgerKey.replace(/\d+$/, 'N'), r.expectedCents, r.paid]), [['settlement-N', 7200, true]]);
});

test('rule 28 — cash on the books and chèques-vacances are not expected at the bank', () => {
  const id = addReservation({ depositAmount: 0, balanceAmount: 0, finalPrice: 500, endOfStayComplementAmount: 100,
    endOfStayComplementPaid: 1, endOfStayComplementPaidDate: dayAt(-1) });
  settlements.insert({
    reservationId: id, targetKind: 'bucket', targetKey: 'endOfStayComplement', paidDate: dayAt(-1), dueCents: 10000,
    parts: [{ kind: 'endOfStayComplement', key: 'endOfStayComplement', amountCents: 10000 }],
    lines: [{ method: 'cash', amountCents: 4000, internal: false }, { method: 'holidayVoucher', amountCents: 6000, internal: false }],
  });
  assert.deepEqual(of(id), []);
});
