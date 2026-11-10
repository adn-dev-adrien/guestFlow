// specs/guest-app.md rule 100 (fifth pass, 2026-11-10) — the arrival note of a card order carries the TRUE unit price: the units billed at
// the catalogue price, the free part (an hour offered, a free unit) said apart — never the amount spread over every unit sold
// (« 2 × 15 € » for 1 h offered + 1 h at 30 €). Also pins the fallback of rule 97 (amount that does not divide, payment short): one unit.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./hourlyResourcesFixture').liveHourlyResources();
const { skipWithout } = require('../plugins/sdk/testing');

const db = require('../database');
const { commitOrder } = require('../utils/midStayOrderCommit');

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
db.prepare('INSERT INTO property_option_prices (optionId, propertyId, price, freeUnits) VALUES (102, 1, 6.5, 2)').run();
db.prepare("INSERT INTO resources (id, name, quantity, price, priceType, propertyId) VALUES (202, 'Bain', 1, 30, 'per_hour', 1)").run();
db.prepare('INSERT INTO resource_properties (resourceId, propertyId) VALUES (202, 1)').run();
db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes) VALUES (1, 202, 30, 60)').run();

let sequence = 0;
function seedStay() {
  const start = 5 + 10 * sequence;
  const id = Number(db.prepare(`INSERT INTO reservations
      (propertyId, clientId, startDate, endDate, adults, children, teens, babies, platform, totalPrice, discountPercent, finalPrice,
       depositAmount, balanceAmount, depositDisabled, touristTaxTotal, kind, checkInDone, checkInTime, checkOutTime, singleBeds,
       doubleBeds, babyBeds, complementPaid, cautionAmount, balanceDueDate, balancePaid, reservationNumber)
      VALUES (1, 1, ?, ?, 2, 0, 0, 0, 'direct', 400, 0, 400, 0, 400, 1, 0, 'reservation', 0, '16:00', '10:00', 0, 0, 0, 0, 0, ?, 1, ?)`)
    .run(isoPlus(start), isoPlus(start + 4), isoPlus(start), `2026${String(++sequence).padStart(5, '0')}`).lastInsertRowid);
  for (let i = start; i < start + 4; i += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Base', 'night', 100)").run(id, isoPlus(i));
  }
  return { id, start };
}
const paid = (amountCents, reference) => ({ amountCents, paidDate: isoPlus(0), reference });
const noteLines = (id) => JSON.parse(db.prepare('SELECT midStaySettledNotes FROM reservations WHERE id = ?').get(id).midStaySettledNotes)[0].lines;

test('rule 100 (LOW 2): a bath of 1 h offered + 1 h at 30 € reads « 1 × 30 € » with the offered hour said, never « 2 × 15 € »', { skip: skipWithout(['hourly-resources']) }, () => {
  const { id, start } = seedStay();
  const lines = [{ kind: 'resource', id: 202, sessions: [{ date: isoPlus(start + 1), start: '12:00', end: '14:00' }] }];
  const result = commitOrder(id, { ...named(1), lines, paid: paid(3000, 'pay_1') });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const [line] = noteLines(id);
  assert.deepEqual([line.qty, line.unitPrice, line.amount], [1, 30, 30]);
  assert.match(line.label, /1 h offerte/);
});

test('rule 100 (LOW 2): 4 units of an article with 2 free units at 6,50 € read « 2 × 6,50 € », the 2 free units said apart, never « 4 × 3,25 € »', () => {
  const { id } = seedStay();
  const result = commitOrder(id, { ...named(2), lines: [{ kind: 'option', id: 102, quantity: 4 }], paid: paid(1300, 'pay_2') });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const [line] = noteLines(id);
  assert.deepEqual([line.qty, line.unitPrice, line.amount], [2, 6.5, 13]);
  assert.match(line.label, /2 offerts/);
});

test('rule 100, 97 (Q7): a payment that does not divide into whole catalogue units keeps the amount paid on ONE unit', () => {
  const { id } = seedStay();
  commitOrder(id, { ...named(3), lines: [{ kind: 'option', id: 102, quantity: 5 }], paid: paid(1000, 'pay_3') });
  const [line] = noteLines(id);
  assert.deepEqual([line.qty, line.unitPrice, line.amount], [1, 10, 10]);
  assert.doesNotMatch(line.label, /offert/);
});

test('rule 97 (Q7): units that split the amount only by spreading it (3 units, 10 €) are never stored as « 3 × 3,33 € » — one unit of 10 €', () => {
  const { id } = seedStay();
  require('../models/reservationsModel').settleOrderNoteBeforeArrival(id, {
    items: [{ key: 'opt:102', amount: 10, quantity: 3 }, { key: 'opt:102', amount: 13, quantity: 2 }], paidDate: isoPlus(0), source: 'shopOrder', ref: 4,
  });
  assert.deepEqual(noteLines(id).map((l) => [l.qty, l.unitPrice, l.amount]), [[1, 10, 10], [2, 6.5, 13]]);
});
