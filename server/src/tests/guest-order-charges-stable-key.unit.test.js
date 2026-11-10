// specs/guest-app.md rule 83 (audit of the J-7 branch, item 13) — an order's evening charge travels the fiche's delete-and-
// reinsert by the row's own id, never by its label: the SAS's evening supplement and two orders' charges share the same words,
// a renamed or reordered line neither loses its key nor takes another's, and the SAS marker stays on the SAS line.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./hourlyResourcesFixture').liveHourlyResources();

const db = require('../database');
const { commitOrder } = require('../utils/midStayOrderCommit');
const { toUpdateBody } = require('../utils/reservationUpdateBody');
const reservations = require('../models/reservationsModel');
const { performUpdate } = require('../controllers/reservationsController');

const LABEL = 'Bain nordique — supplément soirée';
const named = (ref) => ({ source: 'shopOrder', ref, history: { field: 'shopOrder', label: 'Commande boutique', text: `Commande boutique #${ref}` } });
const isoPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

db.prepare("INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled) VALUES (1, 'Gîte', 8, 'per_day_per_person', 0, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();

function seedStay() {
  const id = Number(db.prepare(`INSERT INTO reservations
      (propertyId, clientId, startDate, endDate, adults, children, teens, babies, platform, totalPrice, discountPercent, finalPrice,
       depositAmount, balanceAmount, depositDisabled, touristTaxTotal, kind, checkInDone, checkInTime, checkOutTime, singleBeds,
       doubleBeds, babyBeds, complementPaid, cautionAmount, balanceDueDate, balancePaid)
      VALUES (1, 1, ?, ?, 2, 0, 0, 0, 'direct', 400, 0, 400, 0, 400, 1, 0, 'reservation', 0, '16:00', '10:00', 0, 0, 0, 0, 0, ?, 1)`)
    .run(isoPlus(5), isoPlus(9), isoPlus(5)).lastInsertRowid);
  for (let i = 5; i < 9; i += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Base', 'night', 100)").run(id, isoPlus(i));
  }
  return id;
}
const charge = (order, amount) => ({ kind: 'charge', key: `guest-order:${order}:evening:202`, label: LABEL, amount });
const rows = (id) => db.prepare('SELECT id, description, amount, orderChargeKey, sasArrivalOrigin, sasLineKey FROM reservation_custom_options WHERE reservationId = ? ORDER BY sortOrder, id').all(id);
const saveWith = (id, edit) => {
  const body = toUpdateBody(reservations.getByIdWithDetails(id), new Set());
  edit(body);
  const saved = performUpdate(id, body, { beforeArrival: true });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
};

test('rule 83: a line typed with the same words, placed before the order\'s charge, never takes its key — the key follows the row\'s id', () => {
  const id = seedStay();
  assert.equal(commitOrder(id, { ...named(8), lines: [charge(8, 10)] }).status, 200);
  assert.equal(commitOrder(id, { ...named(9), lines: [charge(9, 5)] }).status, 200);
  saveWith(id, (body) => {
    body.customOptions.unshift({ description: LABEL, amount: 3 });
  });
  const after = rows(id);
  assert.equal(after.length, 3);
  assert.deepEqual(after.filter((r) => r.orderChargeKey).map((r) => [r.amount, r.orderChargeKey]).sort((a, b) => a[0] - b[0]),
    [[5, 'guest-order:9:evening:202'], [10, 'guest-order:8:evening:202']]);
  assert.equal(after.find((r) => Number(r.amount) === 3).orderChargeKey, null);
});

test('rule 83: the SAS\'s evening supplement shares the order\'s words — the order keeps its key, the SAS line keeps its marker and takes none', () => {
  const id = seedStay();
  assert.equal(commitOrder(id, { ...named(10), lines: [charge(10, 20)] }).status, 200);
  db.prepare("UPDATE reservation_custom_options SET orderChargeKey = NULL, sasArrivalOrigin = 1, sasLineKey = 'hourly:supplement:202' WHERE reservationId = ?").run(id);
  assert.equal(commitOrder(id, { ...named(11), lines: [charge(11, 10)] }).status, 200);
  saveWith(id, (body) => {
    body.customOptions.unshift({ description: 'Autre ligne', amount: 4 });
    body.customOptions.reverse();
  });
  const after = rows(id);
  const order = after.find((r) => r.orderChargeKey);
  const sas = after.find((r) => Number(r.sasArrivalOrigin) === 1);
  assert.deepEqual([order.amount, order.orderChargeKey, Number(order.sasArrivalOrigin || 0)], [10, 'guest-order:11:evening:202', 0]);
  assert.deepEqual([sas.amount, sas.orderChargeKey, sas.sasLineKey], [20, null, 'hourly:supplement:202']);
  assert.equal(after.length, 3);
});

test('rule 83: a charge written after a SAS supplement of the same words tags its own row, never the SAS line', () => {
  const id = seedStay();
  assert.equal(commitOrder(id, { ...named(12), lines: [charge(12, 20)] }).status, 200);
  db.prepare("UPDATE reservation_custom_options SET orderChargeKey = NULL, sasArrivalOrigin = 1, sasLineKey = 'hourly:supplement:202' WHERE reservationId = ?").run(id);
  const result = commitOrder(id, { ...named(13), lines: [charge(13, 10)] });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const after = rows(id);
  assert.deepEqual(after.filter((r) => r.orderChargeKey).map((r) => [r.amount, r.orderChargeKey]), [[10, 'guest-order:13:evening:202']]);
  assert.equal(after.find((r) => Number(r.sasArrivalOrigin) === 1).orderChargeKey, null);
});
