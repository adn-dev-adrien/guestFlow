// specs/establishment-closures.md rule 17 — the closure check of a
// new or moved stay reads the nights the stay really takes (early check-in / late check-out), exactly
// like the overlap check against other stays and like closure creation does (audit 2026-10-28).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const reservationsModel = require('../models/reservationsModel');
const closures = require('../models/establishmentClosuresModel');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function withClosureSpy(run) {
  const original = closures.findCoveringClosure;
  const calls = [];
  closures.findCoveringClosure = (propertyId, start, end) => { calls.push([start, end]); return null; };
  try { run(calls); } finally { closures.findCoveringClosure = original; }
}

function model() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  return reservationsModel.create(db);
}

test('a late check-out is checked against the closure on the night it blocks', () => {
  withClosureSpy((calls) => {
    model().validateAvailability(1, '2027-05-07', '2027-05-10', '15:00', '18:00', null, { blocksPreviousNight: 0, blocksNextNight: 1 }, { allowPastDates: true });
    assert.deepEqual(calls, [['2027-05-07', '2027-05-11']]);
  });
});

test('an early check-in is checked against the closure on the night before', () => {
  withClosureSpy((calls) => {
    model().validateAvailability(1, '2027-05-07', '2027-05-10', '09:00', '10:00', null, { blocksPreviousNight: 1, blocksNextNight: 0 }, { allowPastDates: true });
    assert.deepEqual(calls, [['2027-05-06', '2027-05-10']]);
  });
});

test('a stay with ordinary times keeps its plain dates', () => {
  withClosureSpy((calls) => {
    model().validateAvailability(1, '2027-05-07', '2027-05-10', '15:00', '10:00', null, {}, { allowPastDates: true });
    assert.deepEqual(calls, [['2027-05-07', '2027-05-10']]);
  });
});

test('a closure starting the day a late check-out leaves refuses the stay (real closure row)', () => {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (1, 'Travaux', '2027-05-10', '2027-05-20')").run();
  const real = closures.create(db);
  const original = closures.findCoveringClosure;
  closures.findCoveringClosure = real.findCoveringClosure;
  try {
    const m = reservationsModel.create(db);
    const late = m.validateAvailability(1, '2027-05-07', '2027-05-10', '15:00', '18:00', null, { blocksPreviousNight: 0, blocksNextNight: 1 }, { allowPastDates: true });
    assert.equal(late.code, 'CLOSURE_COVERS_DATE');
    const normal = m.validateAvailability(1, '2027-05-07', '2027-05-10', '15:00', '10:00', null, {}, { allowPastDates: true });
    assert.equal(normal, null);
  } finally {
    closures.findCoveringClosure = original;
  }
});
