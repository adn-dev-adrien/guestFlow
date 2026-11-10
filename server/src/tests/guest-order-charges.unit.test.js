// specs/guest-app.md rules 82-83 — core side of the bath orders: the hours the stay already holds and has not placed are
// placed first (the line's sold hours rise only beyond them), and a charge the plugin priced (the evening supplement) is a
// custom line of the fiche tagged with the order's key, carried by later saves.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./hourlyResourcesFixture').liveHourlyResources();
const { skipWithout } = require('../plugins/sdk/testing');

const db = require('../database');
const { commitOrder, priceOrder, mergeOrderLines } = require('../utils/midStayOrderCommit');
const { toUpdateBody } = require('../utils/reservationUpdateBody');
const reservations = require('../models/reservationsModel');

const named = (ref) => ({ source: 'shopOrder', ref, history: { field: 'shopOrder', label: 'Commande boutique', text: `Commande boutique #${ref}` } });
const isoPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

db.prepare("INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled) VALUES (1, 'Gîte', 8, 'per_day_per_person', 0, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
db.prepare("INSERT INTO resources (id, name, quantity, price, priceType, propertyId) VALUES (202, 'Bain', 1, 30, 'per_hour', 1)").run();
db.prepare('INSERT INTO resource_properties (resourceId, propertyId) VALUES (202, 1)').run();
db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes) VALUES (1, 202, 30, 0)').run();

function seedStay({ start = 5, soldHours = 0 } = {}) {
  const id = Number(db.prepare(`INSERT INTO reservations
      (propertyId, clientId, startDate, endDate, adults, children, teens, babies, platform, totalPrice, discountPercent, finalPrice,
       depositAmount, balanceAmount, depositDisabled, touristTaxTotal, kind, checkInDone, checkInTime, checkOutTime, singleBeds,
       doubleBeds, babyBeds, complementPaid, cautionAmount, balanceDueDate, balancePaid)
      VALUES (1, 1, ?, ?, 2, 0, 0, 0, 'direct', 400, 0, 400, 0, 400, 1, 0, 'reservation', 0, '16:00', '10:00', 0, 0, 0, 0, 0, ?, 1)`)
    .run(isoPlus(start), isoPlus(start + 4), isoPlus(start)).lastInsertRowid);
  for (let i = start; i < start + 4; i += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Base', 'night', 100)").run(id, isoPlus(i));
  }
  if (soldHours > 0) {
    db.prepare(`INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, totalPrice, offered, inComplement, sessions)
                VALUES (?, 202, ?, 0, ?, 0, 1, 0, '[]')`).run(id, soldHours, soldHours);
  }
  return id;
}
const session = (day, start, end) => ({ date: isoPlus(day), start, end });
const resourceRow = (id) => db.prepare('SELECT * FROM reservation_resources WHERE reservationId = ? AND resourceId = 202').get(id);

test('rule 82: sold hours not yet placed are placed first — sessions inside them raise nothing', { skip: skipWithout(['hourly-resources']) }, () => {
  const body = { options: [], resources: [{ resourceId: 202, quantity: 2, offered: true, sessions: [] }] };
  const inside = mergeOrderLines(body, [{ kind: 'resource', id: 202, sessions: [session(6, '18:00', '20:00')] }]);
  assert.equal(inside.resources[0].quantity, 2);
  assert.equal(inside.resources[0].sessions.length, 1);
  const beyond = mergeOrderLines(body, [{ kind: 'resource', id: 202, sessions: [session(6, '18:00', '21:00')] }]);
  assert.equal(beyond.resources[0].quantity, 3, 'only the hour beyond the two held hours is sold more');
  const partlyPlaced = { options: [], resources: [{ resourceId: 202, quantity: 2, offered: true, sessions: [session(6, '10:00', '11:00')] }] };
  const next = mergeOrderLines(partlyPlaced, [{ kind: 'resource', id: 202, sessions: [session(7, '10:00', '12:00')] }]);
  assert.equal(next.resources[0].quantity, 3, 'one held hour left, two placed: one more sold');
});

test('rule 82: an order placing the held hours of the stay costs nothing and writes the sessions on the line', { skip: skipWithout(['hourly-resources']) }, () => {
  const id = seedStay({ soldHours: 2 });
  const priced = priceOrder(id, [{ kind: 'resource', id: 202, sessions: [session(6, '18:00', '20:00')] }]);
  assert.deepEqual([priced.status, priced.total], [200, 0]);
  const result = commitOrder(id, { ...named(1), lines: [{ kind: 'resource', id: 202, sessions: [session(6, '18:00', '20:00')] }] });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const stored = resourceRow(id);
  assert.equal(Number(stored.quantity), 2);
  assert.equal(JSON.parse(stored.sessions).length, 1);
  assert.equal(db.prepare('SELECT complementAmount FROM reservations WHERE id = ?').get(id).complementAmount, 0);
});

test('rule 83: a charge line is a custom line of the fiche tagged with the order key, routed to the arrival complement', () => {
  const id = seedStay();
  const charge = { kind: 'charge', key: 'guest-order:7:evening:202', label: 'Bain nordique — supplément soirée', amount: 10 };
  const priced = priceOrder(id, [charge]);
  assert.deepEqual([priced.status, priced.total], [200, 10]);
  const result = commitOrder(id, { ...named(7), lines: [charge] });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.total, 10);
  const row = db.prepare('SELECT description, amount, orderChargeKey, inComplement FROM reservation_custom_options WHERE reservationId = ?').get(id);
  assert.deepEqual([row.description, row.amount, row.orderChargeKey, row.inComplement], ['Bain nordique — supplément soirée', 10, 'guest-order:7:evening:202', 1]);
  assert.equal(db.prepare('SELECT complementAmount FROM reservations WHERE id = ?').get(id).complementAmount, 10);
});

test('rule 83: the tag survives the operator\'s next save of the fiche, and two orders keep their own keys', () => {
  const id = seedStay();
  commitOrder(id, { ...named(8), lines: [{ kind: 'charge', key: 'guest-order:8:evening:202', label: 'Bain nordique — supplément soirée', amount: 10 }] });
  commitOrder(id, { ...named(9), lines: [{ kind: 'charge', key: 'guest-order:9:evening:202', label: 'Bain nordique — supplément soirée', amount: 5 }] });
  const saved = require('../controllers/reservationsController').performUpdate(id, toUpdateBody(reservations.getByIdWithDetails(id), new Set()), { beforeArrival: true });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const rows = db.prepare('SELECT amount, orderChargeKey FROM reservation_custom_options WHERE reservationId = ? ORDER BY id').all(id);
  assert.deepEqual(rows.map((r) => [r.amount, r.orderChargeKey]), [[10, 'guest-order:8:evening:202'], [5, 'guest-order:9:evening:202']]);
});

test('rule 83: a 0 € charge is not written', () => {
  const id = seedStay();
  const result = commitOrder(id, { ...named(10), lines: [{ kind: 'charge', key: 'guest-order:10:evening:202', label: 'Bain nordique — supplément soirée', amount: 0 }] });
  assert.equal(result.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_custom_options WHERE reservationId = ?').get(id).n, 0);
});
