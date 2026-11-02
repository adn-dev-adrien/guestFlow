// specs/vat-optional-mode.md rule 37 (e) and specs/reservation-refunds.md rule 48, reading of 2026-11-02 (review of
// #925). The indemnity of a cancelled stay counts at face value — no VAT, no tourist tax taken out. A refund given
// back from it (bucket `indemnity`) must lower the turnover at that same face value; it used to go through the
// stay's HT ratio like the refund of a sale, so the turnover kept part of an indemnity the guest got back.

const test = require('node:test');
const assert = require('node:assert/strict');

const { franchiseDb, insert, addRefund, TODAY } = require('./vatFranchiseFixture');

const collected = (model) => model.getFollowUp({ today: TODAY }).collected;

function cancelledStayWithKeptAcompte() {
  const fixture = franchiseDb();
  const { db } = fixture;
  db.exec(`CREATE TABLE reservation_refund_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT, refundId INTEGER, lineKey TEXT, label TEXT, bucket TEXT, amountTtc REAL, vatRate REAL
  )`);
  const id = insert(db, { kind: 'cancelled', startDate: '2026-09-01', endDate: '2026-09-04', finalPrice: 800, touristTaxTotal: 100, depositAmount: 300, depositPaid: 1, depositPaidDate: '2026-03-01' });
  addRefund(db, id, '2026-05-30', 300, 'retained');
  db.prepare("INSERT INTO cancellation_compensations (reservationId, receivedAmount, receivedDate, status, origin) VALUES (?, 300, '2026-05-30', 'received', 'retained_deposit')").run(id);
  return { ...fixture, id };
}

const addLine = (db, refundId, bucket, amountTtc) => db
  .prepare("INSERT INTO reservation_refund_lines (refundId, lineKey, label, bucket, amountTtc, vatRate) VALUES (?, 'accommodation', 'Hébergement', ?, ?, 0)")
  .run(Number(refundId), bucket, amountTtc);

test('rule 37 (e): a refund taken from the indemnity lowers the franchise turnover at face value', () => {
  const { db, model, id } = cancelledStayWithKeptAcompte();
  assert.equal(collected(model), 300, 'the kept acompte counts once');
  const refund = addRefund(db, id, '2026-06-10', 120).lastInsertRowid;
  addLine(db, refund, 'indemnity', 120);
  assert.equal(collected(model), 180);
});

test('rule 37 (e): a mixed refund — the sale share keeps the stay ratio, the indemnity share counts at face value', () => {
  const { db, model, id } = cancelledStayWithKeptAcompte();
  db.prepare('UPDATE reservations SET balanceAmount = 500, balancePaid = 1, balancePaidDate = ? WHERE id = ?').run('2026-04-01', id);
  assert.equal(collected(model), 744.44, 'acompte 300 + paid solde 500 × 800/900');
  const refund = addRefund(db, id, '2026-06-10', 600).lastInsertRowid;
  addLine(db, refund, 'accommodation', 500);
  addLine(db, refund, 'indemnity', 100);
  assert.equal(collected(model), 200);
});
