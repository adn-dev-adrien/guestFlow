// specs/direct-installments.md rules 35-38 — the plan at the door and in the books: what is due at arrival, the
// SAS settling it, the fiscal attribution date, the bank reconciliation, and the paid buckets a plan never zeroes.
const test = require('node:test');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { stayDueAtArrival } = require('../utils/reservationSettlement');
const { buildPaymentDeadlineRows } = require('../utils/paymentDeadlines');
const { create: createReservationsModel } = require('../models/reservationsModel');
const { buildLedger } = require('../utils/reservationLedger');
const { parseGroup } = require('../utils/arrivalPaymentGroup');
const { receiptsOfReservation } = optionalPlugin(() => require('../plugins/online-payment/reconciliation/expectedReceipts'));
const { createFicheWriter } = optionalPlugin(() => require('../plugins/online-payment/reconciliation/ficheWriter'));
const { applyPaymentMark } = require('../utils/reservationPaymentMark');
const { calculateReservationQuote } = require('../utils/pricing');
const { __test: { paymentMarkRefusal } } = require('../controllers/reservationsController');
const { createHarness, call, TODAY } = require('./directInstallmentsFixtures');

const stay = (extra = {}) => ({ finalPrice: 1000, depositAmount: 0, balanceAmount: 0, installmentsPaidAmount: 0, installmentsUnpaidAmount: 600, ...extra });

// ── Rule 36 — due at the door ───────────────────────────────────────────────────────────────────────
test('rule 36 — what a plan still owes is due at arrival, and nothing is once it is collected or covered', () => {
  const due = stayDueAtArrival(stay({ installmentsPaidAmount: 400 }));
  assert.equal(due.total, 600);
  assert.deepEqual([due.installments.due, due.deposit.due, due.balance.due], [600, 0, 0]);
  assert.equal(stayDueAtArrival(stay({ installmentsPaidAmount: 1000, installmentsUnpaidAmount: 0 })).total, 0);
  assert.equal(stayDueAtArrival({ depositAmount: 120, balanceAmount: 360 }).total, 480, 'no plan: unchanged');
});

test('rule 36 — a guest at the door with an unpaid plan is « unpaid_at_arrival » on the payment-deadline card, even before any is late', () => {
  const rows = buildPaymentDeadlineRows([], '2027-06-14', [{
    id: 2, reservationId: 9, number: 2, dueDate: '2027-06-13', amountCents: 33400, startDate: '2027-06-14', endDate: '2027-06-21',
    firstName: 'C', lastName: 'M', propertyName: 'P',
  }]);
  assert.deepEqual([rows[0].state, rows[0].severity, rows[0].totalDue], ['unpaid_at_arrival', 'error', 334]);
});

test('rule 36 — settling at the SAS marks every remaining installment paid today with the chosen mode; « Pas maintenant » leaves them', async () => {
  const h = createHarness({ stay: { startDate: '2027-06-14', endDate: '2027-06-16' } });
  h.state.quote = { preArrivalAmount: 1001.5, depositAmount: 0, balanceAmount: 0, depositDueDate: null, balanceDueDate: null };
  await call(h.controller.put, { params: { id: h.reservationId }, body: { count: 3 } });
  const [first] = h.installmentsModel.listFor(h.reservationId);
  await call(h.controller.markPaid, { params: { id: h.reservationId, installmentId: first.id }, body: { paidDate: TODAY, method: 'transfer' } });

  const model = createReservationsModel(h.db);
  model.commitArrivalSas(h.reservationId, { stayPaid: false });
  assert.equal(h.installmentsModel.listFor(h.reservationId).filter((i) => i.paid).length, 1);
  model.commitArrivalSas(h.reservationId, { stayPaid: true, stayPaidCash: false });
  const rows = h.installmentsModel.listFor(h.reservationId);
  assert.ok(rows.every((i) => Number(i.paid) === 1));
  assert.deepEqual(rows.slice(1).map((i) => [i.paidMethod, i.paidDate.length]), [['card', 10], ['card', 10]]);
  const after = h.db.prepare('SELECT installmentsUnpaidAmount, installmentsPaidAmount, depositPaid, balancePaid FROM reservations WHERE id = ?').get(h.reservationId);
  assert.deepEqual([after.installmentsUnpaidAmount, after.installmentsPaidAmount, after.depositPaid, after.balancePaid], [0, 1001.5, 0, 0], 'the buckets stay untouched');
});

test('rule 36 — « Espèces » at the SAS records the remaining installments as cash', async () => {
  const h = createHarness({ stay: { startDate: '2027-06-14', endDate: '2027-06-16' } });
  h.state.quote = { preArrivalAmount: 1001.5, depositAmount: 0, balanceAmount: 0, depositDueDate: null, balanceDueDate: null };
  await call(h.controller.put, { params: { id: h.reservationId }, body: { count: 3 } });

  createReservationsModel(h.db).commitArrivalSas(h.reservationId, { stayPaid: true, stayPaidCash: true });
  assert.deepEqual(h.installmentsModel.listFor(h.reservationId).map((i) => i.paidMethod), ['cash', 'cash', 'cash']);
});

// ── Rule 38 — bank reconciliation ───────────────────────────────────────────────────────────────────
test('rule 38 — each installment is an expected bank receipt; espèces never are; written through the installment mark', { skip: skipWithout(['online-payment']) }, async () => {
  const h = createHarness();
  h.state.quote = { preArrivalAmount: 1001.5, depositAmount: 0, balanceAmount: 0, depositDueDate: null, balanceDueDate: null };
  await call(h.controller.put, { params: { id: h.reservationId }, body: { count: 3 } });
  const [first, second] = h.installmentsModel.listFor(h.reservationId);
  h.installmentsModel.markPaid(second.id, { paidDate: '2026-10-30', method: 'cash' });
  const row = { ...h.db.prepare('SELECT * FROM reservations WHERE id = ?').get(h.reservationId), firstName: 'C', lastName: 'M', propertyName: 'P' };
  const receipts = receiptsOfReservation(row, {
    buildLedger, parseGroup, links: [], today: TODAY, installments: h.installmentsModel.listFor(h.reservationId),
  });
  const own = receipts.filter((r) => r.installmentId);
  assert.deepEqual(own.map((r) => [r.ledgerKey, r.expectedCents, r.paid]), [['installment-1', 33400, false], ['installment-3', 33350, false]]);

  // The writer hands the installment mark to the core's `applyPaymentMark`, which routes it to the plan's handler.
  const handed = [];
  const writer = createFicheWriter({
    model: { recordFicheWrite: () => {} },
    applyPaymentMark: ({ reservationId, body }) => {
      handed.push(body);
      let status = 200;
      let payload = null;
      const res = { status(code) { status = code; return res; }, json(v) { payload = v; return res; } };
      h.controller.markPaid({ params: { id: String(reservationId), installmentId: String(body.installmentId) }, body: { paidDate: body.installmentPaidDate, method: body.installmentMethod } }, res);
      return { status, body: payload };
    },
    computePlatformCommission: () => null,
    reservations: { getRow: (id) => h.db.prepare('SELECT * FROM reservations WHERE id = ?').get(id), addHistoryEntry: () => {} },
  });
  const done = writer.writeIfComplete({
    receipt: own[0], lines: [{ amountCents: 33400, transactionId: 't1', settledAt: '2026-10-26T08:00:00Z' }], expectedBankCents: 33400,
  });
  assert.equal(done.written, true, JSON.stringify(done));
  const stored = h.installmentsModel.findById(first.id);
  assert.deepEqual([stored.paid, stored.paidDate, stored.paidMethod], [1, '2026-10-26', 'transfer']);
  assert.deepEqual(handed, [{ installmentId: first.id, installmentPaidDate: '2026-10-26', installmentMethod: 'transfer' }]);
});

test('rule 38 — the core mark routes an installment body to the plan handler, with the same guards', () => {
  const Module = require('module');
  const calls = [];
  const original = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (id === '../controllers/installmentsController') {
      return { markPaid: (req, res) => { calls.push(req); res.status(200).json({ installmentPlan: null }); } };
    }
    return original.call(this, id);
  };
  try {
    const answer = applyPaymentMark({ reservationId: 7, body: { installmentId: 41, installmentPaidDate: '2026-10-28', installmentMethod: 'transfer' }, user: { id: 1 } });
    assert.equal(answer.status, 200);
    assert.deepEqual([calls[0].params, calls[0].body], [{ id: '7', installmentId: '41' }, { paidDate: '2026-10-28', method: 'transfer' }]);
  } finally {
    Module.prototype.require = original;
  }
});

// ── Rule 35 — a bucket already collected is never zeroed ────────────────────────────────────────────
function engineDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00', touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0, basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0
    );
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL, label TEXT DEFAULT 'Standard', pricePerNight REAL NOT NULL DEFAULT 100, pricingMode TEXT NOT NULL DEFAULT 'fixed',
      progressiveTiers TEXT NOT NULL DEFAULT '[]', dateRanges TEXT NOT NULL DEFAULT '[]', color TEXT NOT NULL DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '', priceType TEXT NOT NULL DEFAULT 'per_stay', price REAL NOT NULL DEFAULT 0,
      optionProgressiveTiers TEXT NOT NULL DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER NOT NULL DEFAULT 0, autoPricingMode TEXT NOT NULL DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0, price REAL NOT NULL DEFAULT 0, priceType TEXT NOT NULL DEFAULT 'per_stay', isComplex INTEGER NOT NULL DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER NOT NULL, resourceId INTEGER NOT NULL, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
    CREATE TABLE reservation_installments (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, number INTEGER NOT NULL, dueDate TEXT NOT NULL, amountCents INTEGER NOT NULL, paid INTEGER NOT NULL DEFAULT 0);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Maison')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, minNights) VALUES (1, 1, 1)').run();
  db.prepare("INSERT INTO reservation_installments (reservationId, number, dueDate, amountCents, paid) VALUES (42, 1, '2026-11-01', 15000, 0), (42, 2, '2026-12-01', 15000, 0)").run();
  return db;
}
const STAY = {
  propertyId: 1, startDate: '2027-07-10', endDate: '2027-07-13', checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0,
  selectedOptions: [], customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '', bookingDate: '2026-10-01', bookingId: 42,
};

test('rule 35 — an acompte or a solde already collected is kept: the plan is ignored rather than zeroing paid money', () => {
  const db = engineDb();
  const withPlan = calculateReservationQuote({ ...STAY, db, depositPaid: false, balancePaid: false });
  assert.deepEqual([withPlan.depositAmount, withPlan.balanceAmount], [0, 0]);
  const paid = calculateReservationQuote({ ...STAY, db, depositPaid: true, depositAmount: 90, balancePaid: false });
  assert.equal(paid.depositAmount, 90);
  assert.equal(paid.balanceAmount, 210);
});

test('rule 35 — « Marquer acompte / solde perçu » is refused on a stay that has a plan', () => {
  const planned = { installmentsTarget: 600, depositAmount: 0, balanceAmount: 0 };
  assert.equal(paymentMarkRefusal(planned, { balancePaid: true }, TODAY).status, 409);
  assert.equal(paymentMarkRefusal(planned, { depositPaid: true }, TODAY).body.code, 'INSTALLMENTS_IN_PLACE');
  assert.notEqual((paymentMarkRefusal({ installmentsTarget: 0, depositAmount: 100, balanceAmount: 0 }, { depositPaid: true }, TODAY) || {}).status, 409);
});
