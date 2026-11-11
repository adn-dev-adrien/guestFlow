// specs/breakfast-offer-price-server-side.md rules 5, 11, 13 — the arrival preview answers the breakfast
// quantity (moments, covers, units, unit price, amount) as the commit will bill it. Real controller,
// real model, in-memory database.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../../database');
const registry = require('../../sdk/registry');
const controller = require('../controller');

registry.configure({ isActive: () => true, allows: () => true });

db.prepare("INSERT INTO properties (id, name, maxGuests) VALUES (1, 'Gîte fictif', 5)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Alex', 'Exemple')").run();
const BREAKFAST = Number(db.prepare(
  `INSERT INTO options (title, priceType, price, autoOptionType, showsPlanningCard, cardRepeat, planningCardTimes, category, displayToClient)
   VALUES ('Petit déjeuner', 'per_person_per_night', 8, 'breakfast', 1, 'once_per_day', '["09:00"]', 'Restauration', 1)`,
).run().lastInsertRowid);

db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(BREAKFAST);

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

let nextId = 700;
function stay(adults) {
  const id = nextId++;
  db.prepare(`INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, platform, adults, complementAmount)
              VALUES (?, 'reservation', 1, 1, ?, ?, 'direct', ?, 0)`).run(id, day(0), day(2), adults);
  return id;
}

const MORNINGS = [{ date: day(1), time: '09:00' }, { date: day(2), time: '09:00' }];
function preview(id, body, user = { id: 1, roles: ['admin'] }) {
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  controller.previewArrival({ params: { id: String(id) }, body, user }, res);
  assert.equal(res.statusCode, 200);
  return res.body.sales.breakfast;
}

test('rule 5 — 2 mornings × 2 covers → 4 units, 32,00 €', () => {
  const id = stay(2);
  assert.deepEqual(preview(id, { soldOptions: [{ optionId: BREAKFAST, occurrences: MORNINGS, persons: 2 }] }), {
    optionId: BREAKFAST, moments: 2, servedPersons: 2, units: 4, unitPrice: 8, amount: 32,
  });
});

test('rule 5 — party of 4, 3 served → 6 units, 48,00 €', () => {
  const id = stay(4);
  const b = preview(id, { soldOptions: [{ optionId: BREAKFAST, occurrences: MORNINGS, persons: 3 }] });
  assert.equal(b.servedPersons, 3);
  assert.equal(b.units, 6);
  assert.equal(b.amount, 48);
});

test('rule 11 — covers asked above the capacity are capped by the server', () => {
  const id = stay(2);
  const b = preview(id, { soldOptions: [{ optionId: BREAKFAST, occurrences: MORNINGS, persons: 9 }] });
  assert.deepEqual([b.servedPersons, b.units, b.amount], [5, 10, 80]);
});

test('rule 5 — nothing ticked → zero units and amount, no covers', () => {
  const id = stay(2);
  assert.deepEqual(preview(id, { soldOptions: [] }), {
    optionId: BREAKFAST, moments: 0, servedPersons: null, units: 0, unitPrice: 8, amount: 0,
  });
});

test('rule 13 — the reception role gets the same figures', () => {
  const id = stay(2);
  const body = { soldOptions: [{ optionId: BREAKFAST, occurrences: MORNINGS, persons: 2 }] };
  assert.deepEqual(preview(id, body, { id: 2, roles: ['reception'] }), preview(id, body));
});
