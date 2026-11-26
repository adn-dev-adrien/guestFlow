// specs/pricing/pricing-components.md §3 rule 54 — a pipeline per caller, chosen by the caller: the fiche sells through `ficheSale`, the SAS
// through `sasSale`, the guest app through `shopSale` (the `staySale` steps, rules 8, 9), the line gestures through `ficheSale`; no caller
// assembles steps, and a sale naming no known pipeline is refused rather than priced as a stay edit.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const extraSale = require('../utils/extraSale');
const controller = require('../controllers/reservationsController');
const pipelines = require('../utils/pricing/pipelines');
const { compose } = require('../utils/pricing/compose');
const pricingInputModel = require('../models/pricingInputModel');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9641, 'Vendeurs', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9641, 'Camille', 'Vente')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight, minNights) VALUES (9641, 'Standard', 100, 1)").run();
const wine = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Panier vin', 25, 'per_stay')").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9641, ?)').run(wine);

const START = addDaysToIsoDate(todayIso(), 20);

function stay() {
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime, balanceDueDate)
    VALUES (9641, 9641, ?, ?, 'direct', 2, 300, 300, 'reservation', '15:00', ?)`).run(START, addDaysToIsoDate(START, 3), START).lastInsertRowid);
  [0, 1, 2].forEach((n) => db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Standard', 'fixed', 100)")
    .run(id, addDaysToIsoDate(START, n)));
  return id;
}

// The pipeline names `performUpdate` receives while `work` runs.
function salesSeen(work) {
  const seen = [];
  const original = controller.performUpdate;
  controller.performUpdate = (id, body, options = {}) => { seen.push(options.sale); return original(id, body, options); };
  try { work(); } finally { controller.performUpdate = original; }
  return seen;
}

test('rule 54 — each seller has its named pipeline, the staySale steps; any other name has none', () => {
  assert.equal(pipelines.salePipelineOf('fiche'), pipelines.ficheSale);
  assert.equal(pipelines.salePipelineOf('sas'), pipelines.sasSale);
  assert.equal(pipelines.salePipelineOf('shop'), pipelines.shopSale);
  for (const name of ['', 'intake', 'stayQuote', 'toString', '__proto__']) assert.equal(pipelines.salePipelineOf(name), null, name);
  for (const pipeline of [pipelines.ficheSale, pipelines.sasSale, pipelines.shopSale]) {
    assert.deepEqual([...pipeline.steps], [...pipelines.staySale.steps]);
    assert.ok(pipeline.steps.includes('storedNights') && !pipeline.steps.includes('nights'));
  }
});

test('rule 54 — COMPOSE runs the seller\'s pipeline: the three give the same quote, an unknown seller is refused', () => {
  const id = stay();
  const input = () => pricingInputModel.load({ db, propertyId: 9641, startDate: START, endDate: addDaysToIsoDate(START, 3), adults: 2, bookingId: id });
  const fiche = compose(input(), { sale: 'fiche' });
  assert.deepEqual(compose(input(), { sale: 'sas' }), fiche);
  assert.deepEqual(compose(input(), { sale: 'shop' }), fiche);
  assert.equal(fiche.finalPrice, 300);
  assert.throws(() => compose(input(), { sale: 'intake' }), /SALE_PIPELINE_UNKNOWN/);
});

test('rule 54 — extraSale names its seller\'s pipeline for every save it plays; an intake line sells as the fiche does', () => {
  const id = stay();
  const request = [{ articleRef: `option:${wine}`, quantity: 1 }];
  assert.deepEqual([...new Set(salesSeen(() => assert.equal(extraSale.quote(id, request, { source: 'shop' }).status, 200)))], ['shop']);
  assert.deepEqual([...new Set(salesSeen(() => assert.equal(extraSale.quote(id, request, { source: 'sas' }).status, 200)))], ['sas']);
  assert.deepEqual([...new Set(salesSeen(() => assert.equal(extraSale.quote(id, request, { source: 'intake' }).status, 200)))], ['fiche']);
  const sold = salesSeen(() => assert.equal(extraSale.sell(id, request, { source: 'shop' }).status, 200));
  assert.deepEqual([...new Set(sold)], ['shop']);
  const line = db.prepare('SELECT lineId FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(id, wine);
  const offered = salesSeen(() => assert.equal(extraSale.changeLine(id, `option:${line.lineId}`, { offered: true }).status, 200));
  assert.deepEqual([...new Set(offered)], ['fiche']);
});

test('rule 54 — a stay edit is no sale: the fiche\'s own save runs stayQuote', () => {
  const id = stay();
  const seen = salesSeen(() => controller.performUpdate(id, { ...require('../utils/stayOrderLines').storedBody(id) }, { dryRun: true }));
  assert.deepEqual(seen, [undefined]);
});
