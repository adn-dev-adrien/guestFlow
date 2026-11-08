// specs/devis-pdf-and-tourist-tax-fixes.md §3.2 rule 7 reading R31-RES-M1 (2026-11-08) — a still-valid quote moved to
// earlier dates kept its stored `validUntil`, so the quote, its PDF and its single payment said « pay by » a date after
// the guest's arrival. The stored date is now read against the new start: at most `startDate − 2`, never before today.
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const devisModel = require('../models/devisModel');
const { validUntilForStart } = require('../utils/devisValidity');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const TODAY = todayIso();
const inDays = (n) => addDaysToIsoDate(TODAY, n);

function freshModel() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT OR REPLACE INTO app_settings (id, quoteValidityDays) VALUES (1, 15)').run();
  db.prepare("INSERT INTO properties (id, name, depositPercent, balanceDaysBefore, maxGuests) VALUES (1, 'Maison test', 30, 30, 6)").run();
  db.prepare('INSERT INTO pricing_rules (propertyId, pricePerNight, minNights) VALUES (1, 120, 1)').run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  let n = 0;
  db.generateDevisNumber = () => `D-R31-${++n}`;
  return { model: devisModel.buildModel(db), db };
}
const stay = (startIn) => ({ propertyId: 1, clientId: 1, startDate: inDays(startIn), endDate: inDays(startIn + 2), adults: 2, platform: 'direct' });

test('rule 7 reading — a stored date is capped at the new start − 2, floored at today', () => {
  assert.equal(validUntilForStart(inDays(15), inDays(42), TODAY), inDays(15), 'a far stay keeps its date');
  assert.equal(validUntilForStart(inDays(15), inDays(10), TODAY), inDays(8), 'moved closer: start − 2');
  assert.equal(validUntilForStart(inDays(15), inDays(2), TODAY), TODAY);
  assert.equal(validUntilForStart(inDays(15), inDays(0), TODAY), TODAY, 'never expired by the move');
  assert.equal(validUntilForStart(null, inDays(2), TODAY), null);
  assert.equal(validUntilForStart(inDays(15), 'not-a-date', TODAY), inDays(15));
});

for (const [to, expected] of [[10, 8], [2, 0], [0, 0]]) {
  test(`rule 7 reading — a valid devis moved from +42 to +${to} days owes its payment by +${expected}, before the arrival`, () => {
    const { model, db } = freshModel();
    const created = model.create(stay(42));
    assert.ok(created.data, JSON.stringify(created));
    assert.equal(db.prepare('SELECT validUntil FROM reservations WHERE id = ?').get(created.data.id).validUntil, inDays(15));
    const updated = model.update(created.data.id, stay(to));
    assert.ok(!updated.error, JSON.stringify(updated));
    const row = db.prepare('SELECT validUntil, balanceDueDate, depositDueDate FROM reservations WHERE id = ?').get(created.data.id);
    assert.equal(row.validUntil, inDays(expected));
    for (const due of [row.balanceDueDate, row.depositDueDate].filter(Boolean)) {
      assert.ok(due <= inDays(Math.max(0, to)), `due ${due} after the arrival ${inDays(to)}`);
      assert.ok(due >= TODAY, `due ${due} before today`);
    }
    const read = model.findById(created.data.id);
    assert.equal(read.expired, false);
  });
}

test('rule 7 reading — a devis moved later keeps its stored date', () => {
  const { model, db } = freshModel();
  const created = model.create(stay(20));
  const before = db.prepare('SELECT validUntil FROM reservations WHERE id = ?').get(created.data.id).validUntil;
  assert.ok(!model.update(created.data.id, stay(80)).error);
  assert.equal(db.prepare('SELECT validUntil FROM reservations WHERE id = ?').get(created.data.id).validUntil, before);
});
