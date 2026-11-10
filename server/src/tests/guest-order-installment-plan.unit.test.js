// specs/guest-app.md rule 95 (fourth pass, 2026-11-10) — an order never moves the installment plan: it goes to the arrival complement,
// and the shop is open only once every installment is paid, so the plan never has to grow. Before the fix the write re-synced the
// plan to the engine's pre-arrival amount and raised `installmentsTarget` above what the plan collected.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./hourlyResourcesFixture').liveHourlyResources();

const db = require('../database');
const installmentsModel = require('../models/installmentsModel');
const { quoteStoredReservation } = require('../utils/storedReservationQuote');
const { commitOrder, orderCollection, amendOrder } = require('../utils/midStayOrderCommit');

const named = (ref) => ({ source: 'shopOrder', ref, history: { field: 'shopOrder', label: 'Commande boutique', text: `Commande boutique #${ref}` } });
const isoPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

db.prepare("INSERT INTO properties (id, name, maxGuests, touristTaxMode, depositEnabled) VALUES (1, 'Gîte', 8, 'none', 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (102, 'Cidre', 6.5, 'per_stay')").run();
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 102)').run();

let sequence = 0;
const PLAN = ['installmentsTarget', 'installmentsPaidAmount', 'installmentsUnpaidAmount', 'installmentsLastPaidDate'];
const MONEY = [
  'totalPrice', 'touristTaxTotal', 'depositAmount', 'balanceAmount', 'endOfStayComplementAmount', 'platformCommissionAmount', ...PLAN,
];
const planRows = (id) => db.prepare('SELECT number, dueDate, amountCents, paid FROM reservation_installments WHERE reservationId = ? ORDER BY number').all(id);

function seedPlanStay({ paid }) {
  const id = Number(db.prepare(`INSERT INTO reservations
      (propertyId, clientId, startDate, endDate, adults, children, teens, babies, platform, totalPrice, discountPercent, finalPrice,
       depositAmount, balanceAmount, depositDisabled, touristTaxTotal, kind, checkInDone, checkInTime, checkOutTime, singleBeds,
       doubleBeds, babyBeds, complementPaid, cautionAmount, balanceDueDate, balancePaid, reservationNumber)
      VALUES (1, 1, ?, ?, 2, 0, 0, 0, 'direct', 800, 0, 800, 0, 800, 1, 0, 'reservation', 0, '16:00', '10:00', 0, 0, 0, 0, 0, ?, 0, ?)`)
    .run(isoPlus(5), isoPlus(9), isoPlus(3), `2026${String(++sequence).padStart(5, '0')}`).lastInsertRowid);
  for (let i = 5; i < 9; i += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Base', 'night', 200)").run(id, isoPlus(i));
  }
  const target = Math.round(Number(quoteStoredReservation(db, db.prepare('SELECT * FROM reservations WHERE id = ?').get(id)).preArrivalAmount) * 100);
  const half = Math.floor(target / 2);
  const model = installmentsModel.buildModel ? installmentsModel.buildModel(db) : installmentsModel;
  model.replacePlan(id, [
    { number: 1, dueDate: isoPlus(-2), amountCents: half },
    { number: 2, dueDate: isoPlus(2), amountCents: target - half },
  ], target);
  if (paid) {
    model.markPaid(model.listFor(id)[0].id, { paidDate: isoPlus(-2), method: 'transfer' });
    model.markPaid(model.listFor(id)[1].id, { paidDate: isoPlus(-1), method: 'transfer' });
    db.prepare('UPDATE reservations SET balancePaid = 1 WHERE id = ?').run(id);
  }
  return id;
}

test('rule 95 (LOW 2): a stay whose plan is fully paid — the order goes to the arrival complement, the plan, its rows and its target stay as they were', () => {
  const id = seedPlanStay({ paid: true });
  assert.equal(orderCollection(id), 'arrival');
  const before = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  const rowsBefore = planRows(id);
  const result = commitOrder(id, { ...named(1), lines: [{ kind: 'option', id: 102, quantity: 2 }] });
  assert.deepEqual([result.status, result.total, result.collectAt], [200, 13, 'arrival'], JSON.stringify(result.body));
  const after = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  assert.deepEqual(MONEY.filter((key) => before[key] !== after[key]), [], 'no plan column, no bucket moves');
  assert.equal(after.complementAmount - before.complementAmount, 13);
  assert.equal(after.finalPrice - before.finalPrice, 13);
  assert.deepEqual(planRows(id), rowsBefore);
  assert.equal(after.installmentsTarget, after.installmentsPaidAmount, 'the plan still collects exactly what it collected');
  const amended = amendOrder(id, {
    ...named(1), from: [{ kind: 'option', id: 102, quantity: 2 }], to: [{ kind: 'option', id: 102, quantity: 1 }],
  });
  assert.equal(amended.status, 200, JSON.stringify(amended.body));
  assert.deepEqual(MONEY.filter((key) => after[key] !== db.prepare('SELECT * FROM reservations WHERE id = ?').get(id)[key]), []);
  assert.deepEqual(planRows(id), rowsBefore);
});

test('rule 95: a plan with an installment still due — the shop is not offered, so no order ever has to grow the plan', () => {
  const id = Number(seedPlanStay({ paid: false }));
  assert.equal(orderCollection(id), 'unavailable');
  const before = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  const result = commitOrder(id, { ...named(2), lines: [{ kind: 'option', id: 102, quantity: 1 }] });
  assert.equal(result.status, 409);
  assert.deepEqual(PLAN.filter((key) => before[key] !== db.prepare('SELECT * FROM reservations WHERE id = ?').get(id)[key]), []);
});
