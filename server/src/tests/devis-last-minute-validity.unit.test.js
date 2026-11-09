// specs/devis-pdf-and-tourist-tax-fixes.md §3.2 rule 6 reading R30-RES-M1 (2026-11-08) — a quote for a stay
// starting within two days used to be « born expired »: its `startDate − 2` cap fell before the issue day,
// the PDF told the guest to pay before the day the quote was made, and « Prolonger » re-issued it expired
// again. `validUntil` is floored at the issue day: such a quote stands, and is due, on the day it is issued.
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const devisModel = require('../models/devisModel');
const { computeValidUntil, isDevisExpired } = require('../utils/devisValidity');
const { __test: { resolveDevisDates } } = require('../utils/devisPdf');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const TODAY = todayIso();
const inDays = (n) => addDaysToIsoDate(TODAY, n);

function freshModel() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT OR REPLACE INTO app_settings (id, quoteValidityDays) VALUES (1, 30)').run();
  db.prepare("INSERT INTO properties (id, name, depositPercent, balanceDaysBefore, maxGuests) VALUES (1, 'Maison test', 30, 30, 6)").run();
  db.prepare('INSERT INTO pricing_rules (propertyId, pricePerNight, minNights) VALUES (1, 120, 1)').run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  let n = 0;
  db.generateDevisNumber = () => `D-R30-${++n}`;
  return { model: devisModel.buildModel(db), db };
}
const stay = (startIn) => ({ propertyId: 1, clientId: 1, startDate: inDays(startIn), endDate: inDays(startIn + 2), adults: 2, platform: 'direct' });

test('rule 6 floor — the validity never falls before the issue day', () => {
  const at = (startIn) => computeValidUntil({ createdAtIsoDate: TODAY, startDateIso: inDays(startIn), quoteValidityDays: 30 });
  assert.equal(at(1), TODAY, 'arrival tomorrow');
  assert.equal(at(0), TODAY, 'arrival today');
  assert.equal(at(-3), TODAY, 'a stay already past');
  assert.equal(at(2), TODAY, 'arrival in two days: the cap is the issue day itself');
  assert.equal(at(3), inDays(1), 'the cap still applies once it lies after the issue day');
  assert.equal(at(400), inDays(30), 'far stays keep createdAt + days');
});

test('rule 6 floor — the PDF fallback of a legacy row (validUntil NULL) runs the same rule', () => {
  const createdAt = `${TODAY} 12:00:00`;
  assert.equal(resolveDevisDates({ createdAt, validUntil: null, startDate: inDays(1) }, { quoteValidityDays: 30 }).validUntilIso, TODAY);
  assert.equal(resolveDevisDates({ createdAt, validUntil: null, startDate: inDays(0) }, { quoteValidityDays: 30 }).validUntilIso, TODAY);
  assert.equal(resolveDevisDates({ createdAt, validUntil: null, startDate: inDays(10) }, { quoteValidityDays: 30 }).validUntilIso, inDays(8), 'capped at start − 2, as the model');
});

for (const startIn of [1, 0]) {
  test(`rule 6 floor — a devis created for a stay at +${startIn} day(s) is valid and due today, never « Périmé · prolonger »`, () => {
    const { model, db } = freshModel();
    const created = model.create(stay(startIn));
    assert.ok(created.data, JSON.stringify(created));
    const row = db.prepare('SELECT validUntil, balanceDueDate, depositDueDate, depositAmount FROM reservations WHERE id = ?').get(created.data.id);
    assert.equal(row.validUntil, TODAY);
    for (const due of [row.balanceDueDate, row.depositDueDate].filter(Boolean)) assert.ok(due >= TODAY, `due ${due} before the issue day`);
    const read = model.findById(created.data.id);
    assert.equal(read.expired, false);
    assert.equal(read.extendable, false);
    assert.equal(model.previewExtension(created.data.id).status, 409, 'nothing to prolong');
  });
}

test('rule 6 floor — « Prolonger » on an expired last-minute quote opens it today, and is no longer offered', () => {
  const { model, db } = freshModel();
  const id = model.create(stay(1)).data.id;
  db.prepare("UPDATE reservations SET validUntil = ?, createdAt = ? WHERE id = ?").run(inDays(-3), `${inDays(-5)} 10:00:00`, id);
  assert.equal(model.findById(id).extendable, true);
  const preview = model.previewExtension(id);
  assert.equal(preview.data.validUntil, TODAY);
  const extended = model.extend(id);
  assert.ok(extended.ok, JSON.stringify(extended));
  const row = db.prepare('SELECT validUntil, balanceDueDate FROM reservations WHERE id = ?').get(id);
  assert.equal(row.validUntil, TODAY);
  assert.ok(!row.balanceDueDate || row.balanceDueDate >= TODAY);
  assert.equal(isDevisExpired(row.validUntil, TODAY), false);
  assert.equal(model.findById(id).extendable, false, 'the endless loop is gone');
});

test('rule 6 floor — « Transformer en devis » on a stay starting tomorrow gives a quote valid today', () => {
  const { model, db } = freshModel();
  const rid = db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, sourceType)
    VALUES ('reservation', 1, 1, ?, ?, 'direct', 2, 240, 240, 'manual')`).run(inDays(1), inDays(3)).lastInsertRowid;
  const converted = model.convertFromReservation(rid);
  assert.ok(!converted.error, JSON.stringify(converted));
  const devisId = (converted.data && (converted.data.id || converted.data.devisId)) || converted.id;
  const row = db.prepare("SELECT validUntil FROM reservations WHERE kind = 'devis' ORDER BY id DESC LIMIT 1").get();
  assert.ok(devisId);
  assert.equal(row.validUntil, TODAY);
});
