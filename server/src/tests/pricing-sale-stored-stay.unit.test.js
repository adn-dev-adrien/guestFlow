// specs/pricing/pricing-components.md §3 rules 8 and 9 — a sale on a stay prices the nights as stored and never judges the stay's shape: the `staySale`
// use case (`storedNights` in place of NIGHTS) behind every `extraSale` write; a stay edit keeps NIGHTS and its refusals.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const extraSale = require('../utils/extraSale');
const controller = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');
const storedNights = require('../utils/pricing/steps/storedNights');
const nights = require('../utils/pricing/steps/nights');
const { stayQuote, staySale } = require('../utils/pricing/pipelines');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9601, 'Nuits', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9601, 'Camille', 'Nuit')").run();
const ruleId = Number(db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight, minNights) VALUES (9601, 'Standard', 100, 1)").run().lastInsertRowid);
const wine = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Panier vin', 25, 'per_stay')").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9601, ?)').run(wine);

const START = addDaysToIsoDate(todayIso(), 20);
const dates = [0, 1, 2, 3].map((n) => addDaysToIsoDate(START, n));
const lock = dates.map((date) => ({ date, seasonLabel: 'Standard', pricingMode: 'fixed', price: 100 }));
// A tariff the steps must not read: NIGHTS reads it, `storedNights` never does.
const untouchable = new Proxy([], { get() { throw new Error('the tariff was read'); } });

function stay() {
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime, balanceDueDate)
    VALUES (9601, 9601, ?, ?, 'direct', 2, 400, 400, 'reservation', '15:00', ?)`).run(START, addDaysToIsoDate(START, 4), START).lastInsertRowid);
  lock.forEach((night) => db.prepare('INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, ?, ?, ?)')
    .run(id, night.date, night.seasonLabel, night.pricingMode, night.price));
  return id;
}

test('rule 52 — staySale is stayQuote with the stored nights, extra guests and tax in the place of NIGHTS, EXTRA GUESTS and TOURIST TAX, nothing else', () => {
  const asStored = { nights: 'storedNights', extraGuests: 'storedExtraGuests', touristTax: 'storedTouristTax' };
  assert.deepEqual([...staySale.steps], stayQuote.steps.map((id) => asStored[id] || id));
  assert.deepEqual([storedNights.requires, storedNights.provides], [nights.requires, nights.provides]);
});

test('rule 8 — the stored nights are the breakdown: the tariff is never read, the figures are NIGHTS\' own on the same lock', () => {
  const ctx = Object.freeze({ startDate: START, endDate: addDaysToIsoDate(START, 4), lockedNightlyBreakdown: lock, rules: untouchable });
  const sold = storedNights.apply(ctx);
  const edited = nights.apply({ ...ctx, rules: [{ id: 1, label: 'Standard', pricePerNight: 130, minNights: 1, dateRanges: '[]' }] });
  assert.deepEqual(sold.nightlyBreakdown, edited.nightlyBreakdown);
  assert.deepEqual([sold.totalPrice, sold.baseAccommodationPrice, sold.nights], [400, 400, 4]);
  assert.deepEqual([...sold.mergedNightly.lockedDates].sort(), dates);
  assert.deepEqual([sold.minNightsBreached, sold.maxNightsBreached, sold.changeover.breached, sold.freshUnpricedNights], [false, false, false, []]);
});

test('rule 8 — stored nights that do not cover the stay are priced by NIGHTS, never judged', () => {
  const ctx = {
    startDate: START, endDate: addDaysToIsoDate(START, 4), lockedNightlyBreakdown: lock.slice(0, 2),
    rules: [{ id: 1, label: 'Standard', pricePerNight: 100, minNights: 9, dateRanges: '[]' }],
  };
  const sold = storedNights.apply(ctx);
  assert.equal(nights.apply(ctx).minNightsBreached, true, 'the edit would refuse it');
  assert.deepEqual([sold.minNightsBreached, sold.totalPrice], [false, 400]);
});

test('rule 9 — a stay sold under a minimum it no longer meets takes a sale; the stay edit is still refused', () => {
  const id = stay();
  db.prepare('UPDATE pricing_rules SET minNights = 7, pricePerNight = 150 WHERE id = ?').run(ruleId);
  try {
    // specs/reservations/platform-stays-always-saveable.md rule 8 — a save that moves nothing judges nothing: the edit is refused once its dates move.
    const edited = controller.performUpdate(id, { ...storedBody(id), endDate: addDaysToIsoDate(storedBody(id).endDate, 1), restatePricing: true }, { dryRun: true });
    assert.equal(edited.status, 409);
    assert.equal(edited.body.code, 'MIN_NIGHTS');
    const sold = extraSale.sell(id, [{ articleRef: `option:${wine}`, quantity: 1 }], { source: 'fiche' });
    assert.equal(sold.status, 200, JSON.stringify(sold.body));
    const row = db.prepare('SELECT totalPrice, finalPrice FROM reservations WHERE id = ?').get(id);
    assert.deepEqual([row.totalPrice, row.finalPrice], [400, 425], 'the nights as stored, the wine added');
    assert.deepEqual(db.prepare('SELECT price FROM reservation_nights WHERE reservationId = ? ORDER BY date').all(id).map((n) => n.price), [100, 100, 100, 100]);
  } finally {
    db.prepare('UPDATE pricing_rules SET minNights = 1, pricePerNight = 100 WHERE id = ?').run(ruleId);
  }
});

test('rule 9 — a changeover day set after the sale is not judged by a later sale', () => {
  const id = stay();
  const arrivalDay = new Date(`${START}T12:00:00Z`).getUTCDay();
  db.prepare('UPDATE pricing_rules SET changeoverArrival = ? WHERE id = ?').run((arrivalDay + 1) % 7, ruleId);
  try {
    // specs/reservations/platform-stays-always-saveable.md rule 8 — a save that moves nothing judges nothing: the edit is refused once its dates move.
    const edited = controller.performUpdate(id, { ...storedBody(id), endDate: addDaysToIsoDate(storedBody(id).endDate, 1), restatePricing: true }, { dryRun: true });
    assert.equal(edited.status, 409);
    const quoted = extraSale.quote(id, [{ articleRef: `option:${wine}`, quantity: 1 }]);
    assert.equal(quoted.status, 200, JSON.stringify(quoted.body));
  } finally {
    db.prepare('UPDATE pricing_rules SET changeoverArrival = NULL WHERE id = ?').run(ruleId);
  }
});
