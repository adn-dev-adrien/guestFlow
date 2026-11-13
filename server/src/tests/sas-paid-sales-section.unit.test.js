// specs/pricing-components.md §3 rules 14, 23, 32 (mock M3, PR C C25) — the departure SAS lists what the stay already collected on its sold lines
// (« Déjà payé »), the operator may offer one of them and the SAS announces what is then owed back; reception sees none of it; the arrival SAS
// keeps the section of the sales made for the departure.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const extraSale = require('../utils/extraSale');
const sasController = require('../plugins/sas/controller');
const { syncStay } = require('../utils/paymentAllocationsSync');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9401, 'Déjà payé', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9401, 'Camille', 'Payé')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (9401, 'Standard', 100)").run();
const optionId = (title, price) => {
  const id = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES (?, ?, 'per_stay')").run(title, price).lastInsertRowid);
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9401, ?)').run(id);
  return id;
};
const wine = optionId('Panier vin', 25);
const bread = optionId('Pain frais', 6);

const sasOf = (id, mode, user = { role: 'admin' }) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  sasController.getSas({ params: { id }, query: { mode }, user }, res);
  return res.body;
};

function startedStay() {
  const startDate = addDaysToIsoDate(todayIso(), -1);
  return Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime, balanceDueDate)
    VALUES (9401, 9401, ?, ?, 'direct', 2, 300, 300, 'reservation', '15:00', ?)`).run(startDate, addDaysToIsoDate(startDate, 3), startDate).lastInsertRowid);
}

test('rule 32 — the departure SAS lists the lines already collected under « Déjà payé »; the arrival SAS keeps its departure section', () => {
  const id = startedStay();
  extraSale.sell(id, [{ articleRef: `option:${wine}`, quantity: 1 }], { payment: 'card-terminal' });
  extraSale.sell(id, [{ articleRef: `option:${bread}`, quantity: 1 }]);
  const departure = sasOf(id, 'departure').staySales;
  assert.equal(departure.title, 'Déjà payé');
  assert.deepEqual(departure.lines.map((l) => [l.label, l.block, l.totalCents]), [['Panier vin', 'paid', 2500]]);
  assert.equal(departure.dueCents, 0);
  assert.equal(departure.refundOwedCents, 0);
  const arrival = sasOf(id, 'arrival').staySales;
  assert.equal(arrival.title, 'Ventes du séjour — au départ');
  assert.deepEqual(arrival.lines.map((l) => [l.label, l.block]), [['Pain frais', 'due'], ['Panier vin', 'paid']]);
});

test('rule 32 — reception sees no money: no « Déjà payé » section', () => {
  const id = startedStay();
  extraSale.sell(id, [{ articleRef: `option:${wine}`, quantity: 1 }], { payment: 'card-terminal' });
  assert.equal(sasOf(id, 'departure', { role: 'reception' }).staySales, null);
});

test('rules 14, 23 — offering a line paid on a settled stay is refused until confirmed; the departure SAS then announces what is owed back', () => {
  const start = addDaysToIsoDate(todayIso(), 40);
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime,
      balanceAmount, balancePaid, balancePaidDate, accommodationSoldeContribTtc)
    VALUES (9401, 9401, ?, ?, 'direct', 2, 300, 340, 'reservation', '15:00', 340, 1, '2026-11-01', 300)`).run(start, addDaysToIsoDate(start, 3)).lastInsertRowid);
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement, soldeContribTtc)
    VALUES (?, ?, 1, 40, 1, 'per_stay', 40, 0, 0, 40)`).run(id, wine);
  syncStay(db, id);
  const section = sasOf(id, 'departure').staySales;
  assert.equal(section.lines.length, 1);
  const { ref } = section.lines[0];
  const refused = extraSale.changeLine(id, ref, { offered: true });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'OVERPAID');
  assert.equal(refused.body.overpaymentTtc, 40);
  assert.equal(extraSale.changeLine(id, ref, { offered: true }, { forceOverpayment: true }).status, 200);
  const after = sasOf(id, 'departure').staySales;
  assert.deepEqual(after.lines, []);
  assert.equal(after.refundOwedCents, 4000);
});
