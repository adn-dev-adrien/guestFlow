const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel } = require('../models/breakfastModel');

// specs/breakfast-option-and-planning-card.md §3 + §7.1. Pins:
//   - rule 4: half-open `(startDate, endDate]` window — startDate morning excluded,
//     endDate morning included.
//   - rule 5: persons = ROUND((adults + teens + children) × qtySum), babies excluded.
//   - rule 3 + edge cases: explicit option ∪ property default fallback.
//
// Plain :memory: fixture covering exactly the tables the model joins.

const DDL = `
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'reservation',
    propertyId INTEGER,
    clientId INTEGER,
    startDate TEXT NOT NULL,
    endDate TEXT NOT NULL,
    adults INTEGER DEFAULT 0,
    teens INTEGER DEFAULT 0,
    children INTEGER DEFAULT 0,
    babies INTEGER DEFAULT 0,
    breakfastTime TEXT,
    breakfastCoffee INTEGER NOT NULL DEFAULT 0,
    breakfastTea INTEGER NOT NULL DEFAULT 0,
    breakfastChocolate INTEGER NOT NULL DEFAULT 0,
    breakfastMilk INTEGER NOT NULL DEFAULT 0,
    breakfastPastries INTEGER NOT NULL DEFAULT 0,
    breakfastCereals INTEGER NOT NULL DEFAULT 0,
    breakfastBread REAL NOT NULL DEFAULT 0,
    breakfastNotifiedDate TEXT,
    arrivalSasDoneAt TEXT,
    breakfastNote TEXT
  );
  CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    firstName TEXT, lastName TEXT
  );
  CREATE TABLE properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT
  );
  CREATE TABLE options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    autoOptionType TEXT,
    breakfastTime TEXT,
    breakfastNotifyLeadMinutes INTEGER NOT NULL DEFAULT 30
  );
  CREATE TABLE reservation_options (
    reservationId INTEGER NOT NULL,
    optionId INTEGER NOT NULL,
    quantity REAL DEFAULT 1,
    PRIMARY KEY (reservationId, optionId)
  );
  CREATE TABLE property_option_defaults (
    propertyId INTEGER NOT NULL,
    optionId INTEGER NOT NULL,
    PRIMARY KEY (propertyId, optionId)
  );
`;

function freshDb() {
  const db = new Database(':memory:');
  db.exec(DDL);
  // Catalog seed: option id=1 is breakfast-typed (default time 08:00); id=2 is a regular option.
  db.prepare("INSERT INTO options (id, title, autoOptionType, breakfastTime) VALUES (1, 'Petit déjeuner', 'breakfast', '08:00')").run();
  db.prepare("INSERT INTO options (id, title, autoOptionType) VALUES (2, 'Départ tardif', NULL)").run();
  return db;
}

function insertProperty(db, id, name) {
  db.prepare('INSERT INTO properties (id, name) VALUES (?, ?)').run(id, name);
}
function insertClient(db, id, firstName, lastName) {
  db.prepare('INSERT INTO clients (id, firstName, lastName) VALUES (?, ?, ?)').run(id, firstName, lastName);
}
function insertReservation(db, props) {
  const cols = ['id', 'kind', 'propertyId', 'clientId', 'startDate', 'endDate', 'adults', 'teens', 'children', 'babies', 'breakfastTime'];
  const values = cols.map((c) => {
    if (props[c] !== undefined) return props[c];
    if (c === 'kind') return 'reservation';
    if (c === 'breakfastTime') return null;
    return 0;
  });
  db.prepare(`INSERT INTO reservations (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...values);
}
function linkOption(db, reservationId, optionId, quantity = 1) {
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity) VALUES (?, ?, ?)').run(reservationId, optionId, quantity);
}
function addPropertyDefault(db, propertyId, optionId) {
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId) VALUES (?, ?)').run(propertyId, optionId);
}

test('explicit option, 3 persons, 3 nights → 3 mornings emitted with correct date range', () => {
  const db = freshDb();
  insertProperty(db, 10, 'Gîte');
  insertClient(db, 100, 'Famille', 'Dupont');
  insertReservation(db, {
    id: 1, propertyId: 10, clientId: 100,
    startDate: '2026-06-09', endDate: '2026-06-12',
    adults: 2, teens: 0, children: 1, babies: 0,
  });
  linkOption(db, 1, 1, 1.0);

  const model = buildModel(db);
  const out = model.breakfastByDate({ from: '2026-06-09', to: '2026-06-15' });
  // 3 mornings: 06-10, 06-11, 06-12 (06-09 = arrival, excluded).
  assert.deepEqual(Object.keys(out).sort(), ['2026-06-10', '2026-06-11', '2026-06-12']);
  // Each morning carries one item with 3 persons (2 adults + 1 child).
  for (const date of ['2026-06-10', '2026-06-11', '2026-06-12']) {
    assert.equal(out[date].items.length, 1);
    assert.equal(out[date].items[0].persons, 3);
    assert.equal(out[date].items[0].clientName, 'Famille Dupont');
    assert.equal(out[date].items[0].propertyName, 'Gîte');
    assert.equal(out[date].totalPersons, 3);
  }
});

test('rule 4 edge — startDate morning excluded, endDate morning included', () => {
  const db = freshDb();
  insertProperty(db, 10, 'P');
  insertReservation(db, {
    id: 2, propertyId: 10, startDate: '2026-06-09', endDate: '2026-06-10',
    adults: 2,
  });
  linkOption(db, 2, 1, 1.0);

  const model = buildModel(db);
  const out = model.breakfastByDate({ from: '2026-06-08', to: '2026-06-12' });
  assert.deepEqual(Object.keys(out), ['2026-06-10'], 'only the morning of endDate');
  assert.equal(out['2026-06-10'].totalPersons, 2);
});

test('babies excluded from the person count', () => {
  const db = freshDb();
  insertProperty(db, 10, 'P');
  insertReservation(db, {
    id: 3, propertyId: 10, startDate: '2026-06-09', endDate: '2026-06-10',
    adults: 2, teens: 0, children: 0, babies: 1,
  });
  linkOption(db, 3, 1, 1.0);

  const model = buildModel(db);
  const out = model.breakfastByDate({ from: '2026-06-09', to: '2026-06-12' });
  assert.equal(out['2026-06-10'].items[0].persons, 2, 'baby NOT counted');
});

test('sub-occupation factor — quantity = 0.6667 × 3 persons → ROUND = 2', () => {
  const db = freshDb();
  insertProperty(db, 10, 'P');
  insertReservation(db, {
    id: 4, propertyId: 10, startDate: '2026-06-09', endDate: '2026-06-10',
    adults: 2, children: 1,
  });
  linkOption(db, 4, 1, 0.6667);

  const model = buildModel(db);
  const out = model.breakfastByDate({ from: '2026-06-09', to: '2026-06-12' });
  // 3 persons × 0.6667 = 2.0001 → ROUND = 2.
  assert.equal(out['2026-06-10'].items[0].persons, 2);
});

test('property default fallback — reservation without explicit row still contributes', () => {
  const db = freshDb();
  insertProperty(db, 10, 'P');
  insertReservation(db, {
    id: 5, propertyId: 10, startDate: '2026-06-09', endDate: '2026-06-11',
    adults: 4,
  });
  // No `reservation_options` row. The property declares the breakfast option as a default.
  addPropertyDefault(db, 10, 1);

  const model = buildModel(db);
  const out = model.breakfastByDate({ from: '2026-06-09', to: '2026-06-12' });
  assert.deepEqual(Object.keys(out).sort(), ['2026-06-10', '2026-06-11']);
  // qtySum = 1.0 (property fallback). 4 adults × 1.0 = 4.
  assert.equal(out['2026-06-10'].items[0].persons, 4);
});

test('devis (kind = "devis") are excluded — only confirmed reservations contribute', () => {
  const db = freshDb();
  insertProperty(db, 10, 'P');
  insertReservation(db, {
    id: 6, kind: 'devis', propertyId: 10, startDate: '2026-06-09', endDate: '2026-06-10',
    adults: 2,
  });
  linkOption(db, 6, 1, 1.0);

  const model = buildModel(db);
  const out = model.breakfastByDate({ from: '2026-06-08', to: '2026-06-12' });
  assert.deepEqual(out, {}, 'devis filtered out by WHERE kind = "reservation"');
});

test('explicit row WINS over property default — no double-counting', () => {
  const db = freshDb();
  insertProperty(db, 10, 'P');
  insertReservation(db, {
    id: 7, propertyId: 10, startDate: '2026-06-09', endDate: '2026-06-10',
    adults: 2,
  });
  // Both signals present: explicit reservation_options row + property default.
  linkOption(db, 7, 1, 1.0);
  addPropertyDefault(db, 10, 1);

  const model = buildModel(db);
  const out = model.breakfastByDate({ from: '2026-06-09', to: '2026-06-12' });
  // Should be 2 persons (explicit qty=1 × 2 adults), NOT 4 (= 2 + 2 from both sources).
  assert.equal(out['2026-06-10'].items[0].persons, 2, 'property default suppressed when explicit row exists');
});

test('window clamping — long stay straddling [from, to] only emits mornings in range', () => {
  const db = freshDb();
  insertProperty(db, 10, 'P');
  insertReservation(db, {
    id: 8, propertyId: 10, startDate: '2026-06-01', endDate: '2026-06-30',
    adults: 1,
  });
  linkOption(db, 8, 1, 1.0);

  const model = buildModel(db);
  const out = model.breakfastByDate({ from: '2026-06-10', to: '2026-06-12' });
  // Only the 3 mornings inside the window.
  assert.deepEqual(Object.keys(out).sort(), ['2026-06-10', '2026-06-11', '2026-06-12']);
});

test('client without name falls back to "Réservation #ID" label', () => {
  const db = freshDb();
  insertProperty(db, 10, 'P');
  // No client row at all (or empty names).
  insertReservation(db, {
    id: 9, propertyId: 10, clientId: 999, startDate: '2026-06-09', endDate: '2026-06-10',
    adults: 2,
  });
  linkOption(db, 9, 1, 1.0);

  const model = buildModel(db);
  const out = model.breakfastByDate({ from: '2026-06-09', to: '2026-06-12' });
  assert.equal(out['2026-06-10'].items[0].clientName, 'Réservation #9');
});

test('multiple reservations on the same morning → both listed, total summed', () => {
  const db = freshDb();
  insertProperty(db, 10, 'Gîte');
  insertProperty(db, 20, 'Studio');
  insertClient(db, 100, 'Famille', 'Dupont');
  insertClient(db, 200, 'M.', 'Martin');
  insertReservation(db, { id: 10, propertyId: 10, clientId: 100, startDate: '2026-06-09', endDate: '2026-06-10', adults: 2, children: 2 });
  insertReservation(db, { id: 11, propertyId: 20, clientId: 200, startDate: '2026-06-09', endDate: '2026-06-10', adults: 2 });
  linkOption(db, 10, 1, 1.0);
  linkOption(db, 11, 1, 1.0);

  const model = buildModel(db);
  const out = model.breakfastByDate({ from: '2026-06-09', to: '2026-06-10' });
  assert.equal(out['2026-06-10'].items.length, 2);
  assert.equal(out['2026-06-10'].totalPersons, 6, '4 + 2 = 6 persons total');
});

// ── Breakfast time (specs/breakfast-time.md) ──────────────────────────────────────────────
test('breakfast time: reservation override wins, else the option default (08:00)', () => {
  const db = freshDb();
  insertProperty(db, 10, 'Gîte');
  insertClient(db, 100, 'Sans', 'Override');
  insertClient(db, 200, 'Avec', 'Override');
  // No per-reservation time → option default 08:00.
  insertReservation(db, { id: 1, propertyId: 10, clientId: 100, startDate: '2026-06-09', endDate: '2026-06-10', adults: 1 });
  linkOption(db, 1, 1, 1.0);
  // Per-reservation override 07:15.
  insertReservation(db, { id: 2, propertyId: 10, clientId: 200, startDate: '2026-06-09', endDate: '2026-06-10', adults: 1, breakfastTime: '07:15' });
  linkOption(db, 2, 1, 1.0);

  const out = buildModel(db).breakfastByDate({ from: '2026-06-09', to: '2026-06-15' });
  const items = out['2026-06-10'].items;
  const byClient = Object.fromEntries(items.map((i) => [i.clientName, i.breakfastTime]));
  assert.equal(byClient['Sans Override'], '08:00');   // option default
  assert.equal(byClient['Avec Override'], '07:15');   // reservation override
});

test('breakfast time: same-day items are sorted by time ascending', () => {
  const db = freshDb();
  insertProperty(db, 10, 'Gîte');
  insertClient(db, 100, 'A', 'Tard');   // 09:30
  insertClient(db, 200, 'B', 'Tot');    // 07:00
  insertClient(db, 300, 'C', 'Defaut'); // 08:00 (option default)
  insertReservation(db, { id: 1, propertyId: 10, clientId: 100, startDate: '2026-06-09', endDate: '2026-06-10', adults: 1, breakfastTime: '09:30' });
  linkOption(db, 1, 1, 1.0);
  insertReservation(db, { id: 2, propertyId: 10, clientId: 200, startDate: '2026-06-09', endDate: '2026-06-10', adults: 1, breakfastTime: '07:00' });
  linkOption(db, 2, 1, 1.0);
  insertReservation(db, { id: 3, propertyId: 10, clientId: 300, startDate: '2026-06-09', endDate: '2026-06-10', adults: 1 });
  linkOption(db, 3, 1, 1.0);

  const items = buildModel(db).breakfastByDate({ from: '2026-06-09', to: '2026-06-15' })['2026-06-10'].items;
  assert.deepEqual(items.map((i) => i.breakfastTime), ['07:00', '08:00', '09:30']);
});

// ---- breakfast composition (specs/sas-breakfast-and-handover-note.md) ----

test('items carry coffee/tea/chocolate/milk/pastries/cereals/bread/note from the reservation (clamped, trimmed)', () => {
  const db = freshDb();
  insertProperty(db, 10, 'Gîte');
  insertClient(db, 100, 'Jean', 'Dupont');
  insertReservation(db, { id: 1, propertyId: 10, clientId: 100, startDate: '2026-06-09', endDate: '2026-06-10', adults: 2 });
  linkOption(db, 1, 1, 1.0);
  db.prepare("UPDATE reservations SET breakfastCoffee = 2, breakfastTea = 0, breakfastChocolate = 1, breakfastMilk = 1, breakfastPastries = 3, breakfastCereals = 1, breakfastBread = 1.5, breakfastNotifiedDate = '2026-06-09', breakfastNote = '  sans gluten  ' WHERE id = 1").run();

  const item = buildModel(db).breakfastByDate({ from: '2026-06-09', to: '2026-06-15' })['2026-06-10'].items[0];
  assert.equal(item.coffee, 2);
  assert.equal(item.tea, 0);
  assert.equal(item.chocolate, 1);
  assert.equal(item.milk, 1);
  assert.equal(item.pastries, 3);
  assert.equal(item.cereals, 1);
  assert.equal(item.bread, 1.5);
  assert.equal(item.notifiedDate, '2026-06-09'); // feeds the breakfast push per-day guard
  assert.equal(item.note, 'sans gluten');
});

test('a from=to=endDate window still carries the departure-day breakfast (push runner / deep-link)', () => {
  // Regression: the window predicate used a strict `endDate > from`, silently dropping the
  // departure-morning item when the window collapses to that very day — exactly what the
  // breakfast push runner and the prep-popup deep-link query (from = to = today).
  const db = freshDb();
  insertProperty(db, 10, 'Gîte');
  insertClient(db, 100, 'Jean', 'Dupont');
  insertReservation(db, { id: 1, propertyId: 10, clientId: 100, startDate: '2026-06-09', endDate: '2026-06-10', adults: 2 });
  linkOption(db, 1, 1, 1.0);

  const day = buildModel(db).breakfastByDate({ from: '2026-06-10', to: '2026-06-10' })['2026-06-10'];
  assert.ok(day, 'departure-day window must not be empty');
  assert.equal(day.items[0].reservationId, 1);
});

test('getForReservation: committed SAS → stored counts verbatim (an explicit 0 stays 0)', () => {
  const db = freshDb();
  insertProperty(db, 10, 'Gîte');
  insertClient(db, 100, 'Jean', 'Dupont');
  insertReservation(db, { id: 1, propertyId: 10, clientId: 100, startDate: '2026-06-09', endDate: '2026-06-12', adults: 2, children: 1, babies: 1, breakfastTime: '09:30' });
  linkOption(db, 1, 1, 1.0);
  db.prepare("UPDATE reservations SET breakfastCoffee = 3, breakfastChocolate = 1, breakfastMilk = 2, breakfastPastries = 4, breakfastCereals = 1, breakfastBread = 0, arrivalSasDoneAt = datetime('now') WHERE id = 1").run();

  const r = buildModel(db).getForReservation(1);
  assert.equal(r.applicable, true);
  assert.equal(r.persons, 3);          // adults 2 + children 1 (babies excluded) × qty 1.0
  assert.equal(r.time, '09:30');       // reservation override
  assert.equal(r.coffee, 3);
  assert.equal(r.tea, 0);
  assert.equal(r.chocolate, 1);
  assert.equal(r.milk, 2);
  assert.equal(r.pastries, 4);
  assert.equal(r.cereals, 1);
  assert.equal(r.bread, 0);            // explicit post-commit 0 is respected
});

test('getForReservation: SAS never committed → smart defaults (pastries = persons, bread = persons × 0.5)', () => {
  const db = freshDb();
  insertProperty(db, 10, 'Gîte');
  insertClient(db, 100, 'Jean', 'Dupont');
  insertReservation(db, { id: 1, propertyId: 10, clientId: 100, startDate: '2026-06-09', endDate: '2026-06-12', adults: 2, children: 1, babies: 1 });
  linkOption(db, 1, 1, 1.0);

  const r = buildModel(db).getForReservation(1);
  assert.equal(r.persons, 3);
  assert.equal(r.pastries, 3);   // = persons
  assert.equal(r.bread, 1.5);    // = persons × 0.5
  assert.equal(r.cereals, 0);    // no default
  assert.equal(r.coffee, 0);
});

test('notifyLeadMinutes: breakfast-option value clamped to [0, 240], default 30', () => {
  const db = freshDb();
  const model = buildModel(db);
  assert.equal(model.notifyLeadMinutes(), 30); // option row has the column default

  db.prepare("UPDATE options SET breakfastNotifyLeadMinutes = 15 WHERE autoOptionType = 'breakfast'").run();
  assert.equal(model.notifyLeadMinutes(), 15);
  db.prepare("UPDATE options SET breakfastNotifyLeadMinutes = 999 WHERE autoOptionType = 'breakfast'").run();
  assert.equal(model.notifyLeadMinutes(), 240);
  db.prepare("UPDATE options SET breakfastNotifyLeadMinutes = -5 WHERE autoOptionType = 'breakfast'").run();
  assert.equal(model.notifyLeadMinutes(), 0);
});

test('getForReservation: applicable via property default (no explicit row) → time falls back to option default', () => {
  const db = freshDb();
  insertProperty(db, 10, 'Gîte');
  insertClient(db, 100, 'Jean', 'Dupont');
  insertReservation(db, { id: 1, propertyId: 10, clientId: 100, startDate: '2026-06-09', endDate: '2026-06-11', adults: 2 });
  addPropertyDefault(db, 10, 1);

  const r = buildModel(db).getForReservation(1);
  assert.equal(r.applicable, true);
  assert.equal(r.persons, 2);
  assert.equal(r.time, '08:00');       // option default (no reservation override)
});

test('getForReservation: NOT applicable when reservation has no breakfast option', () => {
  const db = freshDb();
  insertProperty(db, 10, 'Gîte');
  insertClient(db, 100, 'Jean', 'Dupont');
  insertReservation(db, { id: 1, propertyId: 10, clientId: 100, startDate: '2026-06-09', endDate: '2026-06-11', adults: 2 });
  linkOption(db, 1, 2, 1.0);           // regular option only

  const r = buildModel(db).getForReservation(1);
  assert.equal(r.applicable, false);
  assert.equal(r.persons, 0);
});
