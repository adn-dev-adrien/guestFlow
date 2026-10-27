// specs/qonto-bank-reconciliation.md rule 45 (audit 2026-10-27) — the installments of a plan are read
// through the core's installments model (`sdk.coreModule('installmentsModel')`), never by raw SQL on a
// core table, and a read failure surfaces instead of turning into an empty plan that expects nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, addReservation, TODAY } = require('./reconciliationFixture');
const { expectedReceipts } = require('../reconciliation/expectedReceipts');
const { buildLedger } = require('../../../utils/reservationLedger');
const { parseGroup } = require('../../../utils/arrivalPaymentGroup');
const sdk = require('../../sdk');

const base = { db, startDate: '2026-10-01', today: TODAY, buildLedger, parseGroup, listLinks: () => [] };

test.beforeEach(() => {
  db.prepare('DELETE FROM reservation_installments WHERE reservationId >= 100').run();
  db.prepare('DELETE FROM reservations WHERE id >= 100').run();
});

test('rule 45 — without an injected reader, the plan comes from the core installments model', () => {
  const id = addReservation({ finalPrice: 600, depositAmount: 0, balanceAmount: 0 });
  sdk.coreModule('installmentsModel').buildModel(db).replacePlan(id, [
    { number: 1, dueDate: '2026-10-20', amountCents: 30000 },
    { number: 2, dueDate: '2026-11-01', amountCents: 30000 },
  ], 60000);
  const keys = expectedReceipts(base).filter((r) => r.reservationId === id).map((r) => [r.ledgerKey, r.expectedCents]);
  assert.deepEqual(keys, [['installment-1', 30000], ['installment-2', 30000]]);
});

test('rule 45 — a failing read of the plan is an error, not an empty plan', () => {
  addReservation({ finalPrice: 600, depositAmount: 0, balanceAmount: 0 });
  assert.throws(() => expectedReceipts({ ...base, listInstallments: () => { throw new Error('no such table: reservation_installments'); } }),
    /reservation_installments/);
});
