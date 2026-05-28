const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const closuresModel = require('../models/establishmentClosuresModel');

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'reservation',
    propertyId INTEGER NOT NULL,
    startDate TEXT NOT NULL,
    endDate TEXT NOT NULL,
    checkInTime TEXT DEFAULT '15:00',
    checkOutTime TEXT DEFAULT '10:00'
  );
  CREATE TABLE establishment_closures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    propertyId INTEGER,
    label TEXT NOT NULL DEFAULT 'Fermeture établissement',
    startDate TEXT NOT NULL,
    endDate TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  const ins = db.prepare('INSERT INTO properties (id, name) VALUES (?, ?)');
  ins.run(1, 'Villa A');
  ins.run(2, 'Villa B');
  return { model: closuresModel.create(db), db };
}

function insertReservation(db, propertyId, startDate, endDate, checkInTime = '15:00', checkOutTime = '10:00') {
  return db.prepare(
    'INSERT INTO reservations (propertyId, startDate, endDate, checkInTime, checkOutTime) VALUES (?, ?, ?, ?, ?)'
  ).run(propertyId, startDate, endDate, checkInTime, checkOutTime);
}

// ---------- list ----------

test('list({}) returns sorted rows with property names joined', () => {
  const { model } = freshModel();
  model.insert({ propertyId: 2, label: 'Travaux B', startDate: '2026-10-10', endDate: '2026-10-15' });
  model.insert({ propertyId: null, label: 'Congé annuel', startDate: '2026-08-01', endDate: '2026-08-31' });
  const list = model.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].label, 'Congé annuel');
  assert.equal(list[0].propertyName, null);
  assert.equal(list[1].label, 'Travaux B');
  assert.equal(list[1].propertyName, 'Villa B');
});

test('list({ propertyId: 1 }) returns globals + property-1 closures only', () => {
  const { model } = freshModel();
  model.insert({ propertyId: null, label: 'Global', startDate: '2026-08-01', endDate: '2026-08-10' });
  model.insert({ propertyId: 1, label: 'A only', startDate: '2026-09-01', endDate: '2026-09-05' });
  model.insert({ propertyId: 2, label: 'B only', startDate: '2026-09-10', endDate: '2026-09-15' });

  const list = model.list({ propertyId: 1 });
  const labels = list.map((c) => c.label).sort();
  assert.deepEqual(labels, ['A only', 'Global']);
});

test('list({ propertyId, from, to }) restricts to overlapping range', () => {
  const { model } = freshModel();
  model.insert({ propertyId: null, label: 'Aug', startDate: '2026-08-01', endDate: '2026-08-31' });
  model.insert({ propertyId: null, label: 'Dec', startDate: '2026-12-15', endDate: '2026-12-25' });
  const list = model.list({ propertyId: 1, from: '2026-08-15', to: '2026-09-01' });
  assert.equal(list.length, 1);
  assert.equal(list[0].label, 'Aug');
});

// ---------- findReservationOverlap ----------

test('findReservationOverlap: global closure conflicts with reservation on any property', () => {
  const { model, db } = freshModel();
  insertReservation(db, 2, '2026-09-10', '2026-09-15');
  const hit = model.findReservationOverlap(null, '2026-09-08', '2026-09-12');
  assert.ok(hit, 'expected a conflict');
  assert.equal(hit.propertyId, 2);
});

test('findReservationOverlap: per-property closure only conflicts with same property', () => {
  const { model, db } = freshModel();
  insertReservation(db, 2, '2026-09-10', '2026-09-15');
  // Closure on property 1 should NOT conflict with a reservation on property 2.
  assert.equal(model.findReservationOverlap(1, '2026-09-08', '2026-09-12'), null);
  // Closure on property 2 SHOULD conflict.
  const hit = model.findReservationOverlap(2, '2026-09-08', '2026-09-12');
  assert.ok(hit);
});

test('findReservationOverlap: applies early-check-in (≤10h) and late-check-out (≥17h) expansion', () => {
  const { model, db } = freshModel();
  // Reservation 2026-09-10 → 2026-09-12 with checkOutTime 18:00 → effective endDate 2026-09-13.
  insertReservation(db, 1, '2026-09-10', '2026-09-12', '15:00', '18:00');
  // A closure 2026-09-12 → 2026-09-13 would NOT conflict under strict semantics
  // but DOES conflict thanks to the late-check-out night-block expansion.
  const hit = model.findReservationOverlap(1, '2026-09-12', '2026-09-13');
  assert.ok(hit, 'late-check-out should extend reservation end into 2026-09-12');
});

// ---------- findClosureOverlap ----------

test('findClosureOverlap: new global conflicts with existing global and per-property', () => {
  const { model } = freshModel();
  model.insert({ propertyId: null, label: 'Existing global', startDate: '2026-08-01', endDate: '2026-08-31' });
  assert.ok(model.findClosureOverlap(null, '2026-08-15', '2026-09-05'));

  model.insert({ propertyId: 1, label: 'Property A', startDate: '2026-10-01', endDate: '2026-10-10' });
  assert.ok(model.findClosureOverlap(null, '2026-10-05', '2026-10-15'));
});

test('findClosureOverlap: new per-property conflicts with global and same property; NOT other', () => {
  const { model } = freshModel();
  model.insert({ propertyId: null, label: 'Global', startDate: '2026-08-01', endDate: '2026-08-10' });
  model.insert({ propertyId: 1, label: 'Property A', startDate: '2026-09-01', endDate: '2026-09-10' });
  model.insert({ propertyId: 2, label: 'Property B', startDate: '2026-09-01', endDate: '2026-09-10' });

  // New per-property closure on property 1, overlapping the existing one.
  assert.ok(model.findClosureOverlap(1, '2026-09-05', '2026-09-15'), 'should conflict with existing prop-1 closure');
  // Also overlap the global.
  assert.ok(model.findClosureOverlap(1, '2026-08-05', '2026-08-08'), 'should conflict with global');
  // Property-1 new closure not overlapping anything on property 1 or global.
  assert.equal(model.findClosureOverlap(1, '2026-11-01', '2026-11-05'), null);
  // Property-3 (no closures) → no conflict despite the prop-2 closure.
  assert.equal(model.findClosureOverlap(3, '2026-09-05', '2026-09-15'), null);
});

test('findClosureOverlap: excludeId excludes self when updating', () => {
  const { model } = freshModel();
  const { id } = model.insert({ propertyId: null, label: 'X', startDate: '2026-08-01', endDate: '2026-08-10' });
  // Without excludeId → conflicts with itself.
  assert.ok(model.findClosureOverlap(null, '2026-08-01', '2026-08-10'));
  // With excludeId → no conflict.
  assert.equal(model.findClosureOverlap(null, '2026-08-01', '2026-08-10', id), null);
});

// ---------- findCoveringClosure ----------

test('findCoveringClosure: global closure covers any property', () => {
  const { model } = freshModel();
  model.insert({ propertyId: null, label: 'Annual', startDate: '2026-08-01', endDate: '2026-08-31' });
  assert.ok(model.findCoveringClosure(1, '2026-08-15', '2026-08-20'));
  assert.ok(model.findCoveringClosure(2, '2026-08-15', '2026-08-20'));
});

test('findCoveringClosure: per-property covers only that property', () => {
  const { model } = freshModel();
  model.insert({ propertyId: 1, label: 'Prop A', startDate: '2026-09-01', endDate: '2026-09-10' });
  assert.ok(model.findCoveringClosure(1, '2026-09-05', '2026-09-08'));
  assert.equal(model.findCoveringClosure(2, '2026-09-05', '2026-09-08'), null);
});

// ---------- expandClosuresToDates ----------

test('expandClosuresToDates: inclusive start, exclusive end, sorted, deduplicated', () => {
  const { model } = freshModel();
  const dates = model.expandClosuresToDates([
    { startDate: '2026-09-01', endDate: '2026-09-04' }, // 3 days
    { startDate: '2026-09-03', endDate: '2026-09-05' }, // overlaps with first
  ]);
  assert.deepEqual(dates, ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']);
});

test('expandClosuresToDates: empty / null input returns []', () => {
  const { model } = freshModel();
  assert.deepEqual(model.expandClosuresToDates([]), []);
  assert.deepEqual(model.expandClosuresToDates(null), []);
});

// ---------- update / delete ----------

test('update: modifies the row when found', () => {
  const { model } = freshModel();
  const { id } = model.insert({ propertyId: null, label: 'A', startDate: '2026-09-01', endDate: '2026-09-05' });
  assert.equal(model.update(id, { propertyId: 1, label: 'B', startDate: '2026-10-01', endDate: '2026-10-05' }), true);
  const row = model.findById(id);
  assert.equal(row.propertyId, 1);
  assert.equal(row.label, 'B');
  assert.equal(row.startDate, '2026-10-01');
});

test('delete: removes the row', () => {
  const { model } = freshModel();
  const { id } = model.insert({ propertyId: null, label: 'A', startDate: '2026-09-01', endDate: '2026-09-05' });
  assert.equal(model.delete(id), true);
  assert.equal(model.findById(id), null);
});
