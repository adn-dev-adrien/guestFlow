// specs/reservations-backend-mvc.md rule 27 (audit R43-RES-L2) — a stay
// refused on a closure answered « … « Audit » du 2027-10-04 au 2027-10-08. », the stored ISO days in a French sentence;
// the season overlap refusals did the same. Every one now writes its days the way the screens do: 04/10/2027.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const reservationsModel = require('../models/reservationsModel');
const closures = require('../models/establishmentClosuresModel');
const propertiesModel = require('../models/propertiesModel');
const { formatDateNumeric } = require('../utils/dateFr');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const inDays = (days) => addDaysToIsoDate(todayIso(), days);
const fr = (iso) => iso.split('-').reverse().join('/');
const ISO_DAY = /\d{4}-\d{2}-\d{2}/;

function database() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte'), (2, 'Tente')").run();
  return db;
}

test('the closure refusal of a stay names its days as DD/MM/YYYY', () => {
  const db = database();
  db.prepare("INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (1, 'Audit', ?, ?)").run(inDays(60), inDays(64));
  const original = closures.findCoveringClosure;
  closures.findCoveringClosure = closures.create(db).findCoveringClosure;
  try {
    const refusal = reservationsModel.create(db).validateAvailability(1, inDays(61), inDays(63), '15:00', '10:00', null, {}, {});
    assert.equal(refusal.code, 'CLOSURE_COVERS_DATE');
    assert.equal(refusal.error, `Fermeture en place sur cette période : « Audit » du ${fr(inDays(60))} au ${fr(inDays(64))}.`);
  } finally {
    closures.findCoveringClosure = original;
  }
});

test('the season overlap refusals name their days as DD/MM/YYYY', () => {
  const db = database();
  const model = propertiesModel.buildModel(db);
  const range = (startDate, endDate) => [{ startDate, endDate }];
  assert.ok(model.addPricingRule(1, { label: 'Été', pricePerNight: 120, dateRanges: range(inDays(30), inDays(60)) }).data.id);
  const overlap = model.addPricingRule(1, { label: 'Haute', pricePerNight: 150, dateRanges: range(inDays(40), inDays(70)) });
  assert.equal(overlap.status, 400);
  assert.equal(overlap.error, `Chevauchement avec la saison "Été" (${fr(inDays(30))} au ${fr(inDays(60))}).`);

  const update = model.addPricingRule(1, { label: 'Automne', pricePerNight: 90, dateRanges: range(inDays(80), inDays(90)) });
  const moved = model.updatePricingRule(1, update.data.id, { label: 'Automne', pricePerNight: 90, dateRanges: range(inDays(50), inDays(90)) });
  assert.equal(moved.status, 400);
  assert.doesNotMatch(moved.error, ISO_DAY);

  assert.ok(model.addPricingRule(2, { label: 'Tente été', pricePerNight: 60, dateRanges: range(inDays(35), inDays(45)) }).data.id);
  const applied = model.applyPricingTo(1, { targetPropertyId: 2, replaceExisting: false });
  assert.equal(applied.status, 409);
  assert.doesNotMatch(applied.error, ISO_DAY);
  assert.match(applied.error, new RegExp(fr(inDays(35))));
});

test('formatDateNumeric gives back what is not a day', () => {
  assert.equal(formatDateNumeric(inDays(0)), fr(inDays(0)));
  assert.equal(formatDateNumeric('03-15'), '03-15');
  assert.equal(formatDateNumeric(null), '');
});
