// specs/guest-app.md rule 87 — the core side of changing an unpaid order at the arrival SAS: `amendOrder` lowers (or
// raises) the order's lines on the fiche, never below what the stay held without the order, measured on the arrival
// complement (rule 66), in one transaction with the stay's history entry.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./hourlyResourcesFixture').liveHourlyResources();
const { skipWithout } = require('../plugins/sdk/testing');

const db = require('../database');
const { commitOrder, amendOrder } = require('../utils/midStayOrderCommit');

const named = (ref) => ({ source: 'shopOrder', ref, history: { field: 'shopOrder', label: 'Commande boutique', text: `Commande boutique #${ref}` } });
const amendment = (ref, from, to, extra = {}) => ({
  source: 'shopOrder', ref, history: { field: 'shopOrderAmended', label: 'Commande boutique modifiée', text: `Commande boutique #${ref} modifiée` }, from, to, ...extra,
});
const isoPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

db.prepare("INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled) VALUES (1, 'Gîte', 8, 'per_day_per_person', 0, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (101, 'Ménage', 40, 'per_stay'), (102, 'Cidre', 6, 'per_stay')").run();
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 101), (1, 102)').run();
db.prepare("INSERT INTO resources (id, name, quantity, price, priceType, propertyId) VALUES (202, 'Bain', 1, 30, 'per_hour', 1)").run();
db.prepare('INSERT INTO resource_properties (resourceId, propertyId) VALUES (202, 1)').run();
db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes) VALUES (1, 202, 30, 0)').run();

function seedStay({ start = 5, checkInDone = 0 } = {}) {
  const id = Number(db.prepare(`INSERT INTO reservations
      (propertyId, clientId, startDate, endDate, adults, children, teens, babies, platform, totalPrice, discountPercent, finalPrice,
       depositAmount, balanceAmount, depositDisabled, touristTaxTotal, kind, checkInDone, checkInTime, checkOutTime, singleBeds,
       doubleBeds, babyBeds, complementPaid, cautionAmount, balanceDueDate, balancePaid)
      VALUES (1, 1, ?, ?, 2, 0, 0, 0, 'direct', 400, 0, 440, 0, 440, 1, 0, 'reservation', ?, '16:00', '10:00', 0, 0, 0, 0, 0, ?, 1)`)
    .run(isoPlus(start), isoPlus(start + 4), checkInDone, isoPlus(start)).lastInsertRowid);
  for (let i = start; i < start + 4; i += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Base', 'night', 100)").run(id, isoPlus(i));
  }
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement)
              VALUES (?, 101, 1, 40, 1, 'per_stay', 40, 0, 0)`).run(id);
  return id;
}
const complement = (id) => db.prepare('SELECT complementAmount, depositAmount, balanceAmount, finalPrice FROM reservations WHERE id = ?').get(id);
const cider = (id) => db.prepare('SELECT quantity FROM reservation_options WHERE reservationId = ? AND optionId = 102').get(id);
const history = (id) => db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = ?').all(id).flatMap((r) => JSON.parse(r.changedFields));

test('rule 87: a lower quantity lowers the stay\'s line and the arrival complement by the difference, one history entry', () => {
  const id = seedStay();
  assert.equal(commitOrder(id, { ...named(1), lines: [{ kind: 'option', id: 102, quantity: 3 }] }).status, 200);
  assert.equal(complement(id).complementAmount, 18);
  const result = amendOrder(id, amendment(1, [{ kind: 'option', id: 102, quantity: 3 }], [{ kind: 'option', id: 102, quantity: 1 }]));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual([result.byKey, result.total], [{ 'opt:102': -12 }, -12]);
  assert.equal(complement(id).complementAmount, 6);
  assert.equal(cider(id).quantity, 1);
  assert.ok(history(id).some((c) => c.field === 'shopOrderAmended' && c.to === 'Commande boutique #1 modifiée'));
});

test('rule 87: an article removed takes its line off the fiche; the stay\'s own lines are never touched', () => {
  const id = seedStay();
  commitOrder(id, { ...named(2), lines: [{ kind: 'option', id: 102, quantity: 2 }] });
  const result = amendOrder(id, amendment(2, [{ kind: 'option', id: 102, quantity: 2 }], []));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(cider(id), undefined);
  assert.equal(complement(id).complementAmount, 0);
  assert.equal(db.prepare('SELECT quantity FROM reservation_options WHERE reservationId = ? AND optionId = 101').get(id).quantity, 1);
});

test('rule 87: the lower quantity keeps what a second order added on the same article', () => {
  const id = seedStay();
  commitOrder(id, { ...named(3), lines: [{ kind: 'option', id: 102, quantity: 2 }] });
  commitOrder(id, { ...named(4), lines: [{ kind: 'option', id: 102, quantity: 1 }] });
  assert.equal(amendOrder(id, amendment(3, [{ kind: 'option', id: 102, quantity: 2 }], [])).status, 200);
  assert.equal(cider(id).quantity, 1, 'the other order\'s unit stays');
  assert.equal(complement(id).complementAmount, 6);
});

test('rule 87: raising a quantity adds the difference at the stay\'s price', () => {
  const id = seedStay();
  commitOrder(id, { ...named(5), lines: [{ kind: 'option', id: 102, quantity: 1 }] });
  const result = amendOrder(id, amendment(5, [{ kind: 'option', id: 102, quantity: 1 }], [{ kind: 'option', id: 102, quantity: 3 }]));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.total, 12);
  assert.equal(cider(id).quantity, 3);
});

test('rule 87: an order whose arrival is marked is not editable — 409 ORDER_NOT_EDITABLE, nothing written', () => {
  const id = seedStay();
  commitOrder(id, { ...named(6), lines: [{ kind: 'option', id: 102, quantity: 2 }] });
  db.prepare('UPDATE reservations SET checkInDone = 1 WHERE id = ?').run(id);
  const before = complement(id);
  const result = amendOrder(id, amendment(6, [{ kind: 'option', id: 102, quantity: 2 }], []));
  assert.deepEqual([result.status, result.body.code], [409, 'ORDER_NOT_EDITABLE']);
  assert.deepEqual(complement(id), before);
  assert.equal(cider(id).quantity, 2);
});

test('rule 87: the plugin\'s own row moves with the fiche (within), or neither does', () => {
  const id = seedStay();
  commitOrder(id, { ...named(7), lines: [{ kind: 'option', id: 102, quantity: 2 }] });
  let seen = null;
  amendOrder(id, amendment(7, [{ kind: 'option', id: 102, quantity: 2 }], [{ kind: 'option', id: 102, quantity: 1 }], { within: (outcome) => { seen = outcome.total; } }));
  assert.equal(seen, -6);
  assert.throws(() => amendOrder(id, amendment(7, [{ kind: 'option', id: 102, quantity: 1 }], [], { within: () => { throw new Error('plugin row failed'); } })), /plugin row failed/);
  assert.equal(cider(id).quantity, 1, 'rolled back with the plugin\'s write');
});

test('rule 87: a bath session removed comes off the line, and a charge goes with its order', { skip: skipWithout(['hourly-resources']) }, () => {
  const id = seedStay();
  const day = isoPlus(6);
  const lines = [
    { kind: 'resource', id: 202, sessions: [{ date: day, start: '18:00', end: '20:00' }] },
    { kind: 'charge', key: 'guest-order:8:evening:202', label: 'Bain nordique — supplément soirée', amount: 10 },
  ];
  assert.equal(commitOrder(id, { ...named(8), lines }).status, 200);
  const before = complement(id).complementAmount;
  assert.ok(before > 10);
  const result = amendOrder(id, amendment(8, lines, [], {}));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_resources WHERE reservationId = ?').get(id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_custom_options WHERE reservationId = ?').get(id).n, 0);
  assert.equal(complement(id).complementAmount, 0);
});
