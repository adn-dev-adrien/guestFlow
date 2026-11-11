// specs/direct-installments.md rule 45 (audit 2026-10-27, finding 4) — a stay paid through an installment
// plan is revenue like any other. The engine zeroes its acompte and solde, and `totalSejour` read only
// those buckets: a 600 € stay paid in 3 × 200 € showed 0 € of revenue in the Finance pages, and the
// invariant `comptaCollected + remainingToPay === totalSejour` broke (400 + 200 ≠ 0).
const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb, insert, sum, THIS_YEAR } = require('./financeDashboardFixture');
const financeModel = require('../models/financeModel');
const { buildModel: buildInstallmentsModel } = require('../models/installmentsModel');
const { comptaCollected, remainingToPay } = require('../utils/reservationSettlement');

const Y = THIS_YEAR - 1;

// The fixture's books schema, plus the plan's table and the three aggregates the stay row carries.
function plannedBooks() {
  const books = freshDb();
  books.db.exec(`
    ALTER TABLE reservations ADD COLUMN installmentsPaidAmount REAL NOT NULL DEFAULT 0;
    ALTER TABLE reservations ADD COLUMN installmentsUnpaidAmount REAL NOT NULL DEFAULT 0;
    ALTER TABLE reservations ADD COLUMN installmentsTarget REAL NOT NULL DEFAULT 0;
    ALTER TABLE reservations ADD COLUMN installmentsLastPaidDate TEXT;
    CREATE TABLE reservation_installments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, number INTEGER NOT NULL, dueDate TEXT NOT NULL,
      amountCents INTEGER NOT NULL, paid INTEGER NOT NULL DEFAULT 0, paidDate TEXT, paidMethod TEXT, requestedAt TEXT,
      dateEdited INTEGER NOT NULL DEFAULT 0, amountEdited INTEGER NOT NULL DEFAULT 0, addedCents INTEGER NOT NULL DEFAULT 0
    );
  `);
  // 600 € in 3 × 200 €, the first two collected. The engine zeroed the acompte and the solde (rule 5).
  const id = insert(books.db, { startDate: `${Y}-06-14`, endDate: `${Y}-06-17`, finalPrice: 600, depositAmount: 0, balanceAmount: 0 });
  const installments = buildInstallmentsModel(books.db);
  const plan = installments.replacePlan(id, [
    { number: 1, dueDate: `${Y}-01-10`, amountCents: 20000 },
    { number: 2, dueDate: `${Y}-03-10`, amountCents: 20000 },
    { number: 3, dueDate: `${Y}-05-10`, amountCents: 20000 },
  ], 60000);
  installments.markPaid(plan[0].id, { paidDate: `${Y}-01-10`, method: 'transfer' });
  installments.markPaid(plan[1].id, { paidDate: `${Y}-03-12`, method: 'link' });
  return { ...books, id };
}

test('the invariant holds on a plan: revenue 600 = collected 400 + still due 200', () => {
  const { db, id } = plannedBooks();
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  assert.equal(financeModel.helpers.totalSejour(row), 600, 'not 0');
  assert.equal(comptaCollected(row), 400);
  assert.equal(remainingToPay(row), 200);
});

test('the Finance summary counts the stay at its full value, per property and per channel', () => {
  const { finance } = plannedBooks();
  const summary = finance.getSummary({ from: `${Y}-01-01`, to: `${Y}-12-31` });
  assert.equal(summary.revenueTotal, 600);
  assert.equal(summary.totalCollected, 400);
  assert.equal(summary.reservations[0].totalSejour, 600);
  assert.equal(summary.reservations[0].remainingDue, 200);
  assert.equal(summary.revenueByProperty.find((p) => p.propertyId === 1).revenue, 600);
});

test('booking pace and the projection read the same 600 €', () => {
  const { finance } = plannedBooks();
  assert.deepEqual(finance.getPaceStays({}).map((s) => s.totalSejour), [600]);
  const projection = finance.getProjection({ date: `${Y}-12-31` });
  assert.deepEqual([projection.total, projection.collected, projection.pending], [600, 400, 200]);
});

test('« Encaissé » lists one row per collected installment, dated, adding up to the tile', () => {
  const { dashboard } = plannedBooks();
  const tile = dashboard.getDashboard({ fiscalYear: Y }).data.tiles.collected.amount;
  const { rows, totals } = dashboard.getDashboardDetail('collected', { fiscalYear: Y }).data;
  assert.equal(tile, 400);
  assert.equal(totals.amount, 400);
  assert.equal(sum(rows, 'amount'), 400);
  assert.deepEqual(rows.map((r) => [r.date, r.kind, r.label, r.amount]), [
    [`${Y}-03-12`, 'installment', 'Échéance 2/3', 200],
    [`${Y}-01-10`, 'installment', 'Échéance 1/3', 200],
  ]);
});
