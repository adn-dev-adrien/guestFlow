// specs/manual-price-on-placement-change.md — the review a manual price gets when its booking moves: the pure builder (rules 1, 3,
// 5, 7, 9, 10) and the live quote that prices the reference placement itself (rules 1-4, 11).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, addDaysToIsoDate } = require('./saleRound1Fixtures');

const ctrl = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');
const { buildManualPriceReview, seasonGroups, KEEP_GAP_TOO_LARGE } = require('../utils/manualPriceReview');

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9702, 'Grange', 8, 0)").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (9702, 'Standard', 150)").run();

const nights = (label, ...prices) => prices.map((price) => ({ seasonLabel: label, price }));
const placement = (startDate, endDate, totalPrice, breakdown, propertyId = 1) => ({
  propertyId, startDate, endDate, quote: { totalPrice, nightlyBreakdown: breakdown },
});
// A stand-in engine: final price = the manual price, or the tariff when cleared; options 45 and tax 2 a night on top.
const evaluateAt = (tariff, nightCount) => (customPrice) => {
  const finalPrice = customPrice === '' ? tariff : Number(customPrice);
  return { finalPrice, touristTaxTotal: nightCount * 2 };
};
const REF = placement('2026-12-15', '2026-12-18', 330, nights('Basse', 110, 110, 110));
const MOVED = placement('2026-12-17', '2026-12-22', 700, [...nights('Basse', 110, 110), ...nights('Fêtes', 160, 160, 160)]);

test('rule 1 — no manual price, the same placement, or the same tariff: no review', () => {
  const base = { reference: REF, placement: MOVED, evaluate: evaluateAt(700, 5) };
  assert.equal(buildManualPriceReview({ ...base, customPrice: '' }), null);
  assert.equal(buildManualPriceReview({ ...base, customPrice: null }), null);
  assert.equal(buildManualPriceReview({ ...base, customPrice: 300, placement: { ...REF } }), null);
  const sameTariff = placement('2026-11-02', '2026-11-05', 330, nights('Basse', 110, 110, 110));
  assert.equal(buildManualPriceReview({ ...base, customPrice: 300, placement: sameTariff }), null);
});

test('rule 3 — a platform sale or a started stay is excluded', () => {
  assert.equal(buildManualPriceReview({ customPrice: 300, reference: REF, placement: MOVED, excluded: true, evaluate: evaluateAt(700, 5) }), null);
});

test('rules 5, 6, 8, 9 — gap to the reference tariff, tariff delta, the current manual price and three choices priced by the engine', () => {
  const review = buildManualPriceReview({ customPrice: 300, reference: REF, placement: MOVED, evaluate: evaluateAt(700, 5) });
  assert.equal(review.gap, -30);
  assert.equal(review.customPrice, 300);
  assert.equal(review.tariffDelta, 370);
  assert.equal(review.reference.nights, 3);
  assert.equal(review.placement.nights, 5);
  assert.deepEqual(review.choices.map((c) => [c.key, c.customPrice, c.finalPrice, c.totalStay]), [
    ['keep', 300, 300, 310],
    ['keepGap', 670, 670, 680],
    ['engine', '', 700, 710],
  ]);
});

test('rule 5 — a manual price above the tariff gives a positive gap, rounded to the cent', () => {
  const review = buildManualPriceReview({ customPrice: 345.555, reference: REF, placement: MOVED, evaluate: evaluateAt(700, 5) });
  assert.equal(review.gap, 15.56);
  assert.equal(review.choices.find((c) => c.key === 'keepGap').customPrice, 715.56);
});

test('rule 10 — a gap of 0 leaves two choices; a gap larger than the new tariff is disabled', () => {
  const equal = buildManualPriceReview({ customPrice: 330, reference: REF, placement: MOVED, evaluate: evaluateAt(700, 5) });
  assert.deepEqual(equal.choices.map((c) => c.key), ['keep', 'engine']);
  const cheaper = placement('2026-11-02', '2026-11-03', 110, nights('Basse', 110));
  const big = buildManualPriceReview({ customPrice: 100, reference: REF, placement: cheaper, evaluate: evaluateAt(110, 1) });
  const keepGap = big.choices.find((c) => c.key === 'keepGap');
  assert.equal(keepGap.disabledReason, KEEP_GAP_TOO_LARGE);
  assert.equal(keepGap.customPrice, -120);
});

test('rule 7 — nights grouped by season; a reference with no stored breakdown shows totals only', () => {
  assert.deepEqual(seasonGroups(MOVED.quote.nightlyBreakdown), [
    { label: 'Basse', nights: 2, amount: 220 },
    { label: 'Fêtes', nights: 3, amount: 480 },
  ]);
  assert.equal(seasonGroups([]), null);
  const review = buildManualPriceReview({
    customPrice: 300, reference: { ...REF, useBreakdown: false }, placement: MOVED, evaluate: evaluateAt(700, 5),
  });
  assert.equal(review.reference.seasons, null);
  assert.equal(review.placement.seasons.length, 2);
});

const quoteOf = (body) => new Promise((resolve) => {
  ctrl.calculatePrice({ body, user: { id: 1, role: 'admin' }, params: {}, query: {} }, { status() { return this; }, json: resolve });
});

function savedWithManualPrice() {
  const id = stay(30);
  const saved = ctrl.performUpdate(id, { ...storedBody(id), customPrice: 270 });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  return id;
}
const storedPlacement = (r) => ({ propertyId: r.propertyId, startDate: r.startDate, endDate: r.endDate });

test('rule 11 — the live quote answers no review without a reference', async () => {
  const id = savedWithManualPrice();
  const r = row(id);
  const quote = await quoteOf({ ...storedBody(id), reservationId: id, customPrice: 270, endDate: addDaysToIsoDate(r.endDate, 2) });
  assert.equal(quote.error, undefined, JSON.stringify(quote));
  assert.equal(quote.manualPriceReview, null);
});

test('rules 1, 9 — extending a stored stay with a manual price opens the review, priced by the server', async () => {
  const id = savedWithManualPrice();
  const r = row(id);
  const quote = await quoteOf({
    ...storedBody(id), reservationId: id, customPrice: 270,
    endDate: addDaysToIsoDate(r.endDate, 2), customPriceReference: storedPlacement(r),
  });
  const review = quote.manualPriceReview;
  assert.ok(review, JSON.stringify(quote).slice(0, 400));
  assert.equal(review.reference.totalPrice, 300);
  assert.equal(review.placement.totalPrice, 500);
  assert.equal(review.gap, -30);
  assert.equal(review.reference.propertyName, 'Ronde');
  const keepGap = review.choices.find((c) => c.key === 'keepGap');
  assert.equal(keepGap.customPrice, 470);
  assert.equal(keepGap.finalPrice, 470);
  assert.equal(review.choices.find((c) => c.key === 'engine').finalPrice, 500);
});

test('rule 4 — the stored placement replays the stored tariff, not today\'s', async () => {
  const id = savedWithManualPrice();
  const r = row(id);
  db.prepare("UPDATE pricing_rules SET pricePerNight = 120 WHERE propertyId = 9701").run();
  try {
    const quote = await quoteOf({
      ...storedBody(id), reservationId: id, customPrice: 270, propertyId: 9702, customPriceReference: storedPlacement(r),
    });
    const review = quote.manualPriceReview;
    assert.ok(review, JSON.stringify(quote).slice(0, 400));
    assert.equal(review.reference.totalPrice, 300, 'the stored 3 × 100, not 3 × 120');
    assert.equal(review.placement.totalPrice, 450);
    assert.equal(review.placement.propertyName, 'Grange');
  } finally {
    db.prepare("UPDATE pricing_rules SET pricePerNight = 100 WHERE propertyId = 9701").run();
  }
});

test('rule 3 — a started stay gets no review', async () => {
  const id = stay(-1);
  const r = row(id);
  const quote = await quoteOf({
    ...storedBody(id), reservationId: id, customPrice: 270,
    endDate: addDaysToIsoDate(r.endDate, 1), customPriceReference: storedPlacement(r),
  });
  assert.equal(quote.error, undefined, JSON.stringify(quote).slice(0, 300));
  assert.equal(quote.manualPriceReview, null);
});
