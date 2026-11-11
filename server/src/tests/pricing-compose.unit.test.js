// specs/pricing-components.md §3 rule 4 and §7 (`pricing-compose`) — COMPOSE is `stayQuote` plus `shape()`: the engine's
// answer stays the quote it was before the refactor, key for key. The price-gate stays (production copy and synthetic refund
// stays) are quoted through the current engine and compared, whole quote, with the fingerprints captured on the baseline code
// (`quotes.json`: sorted keys and the SHA-256 of the canonical JSON of each quote); the golden fixture of the VAT regimes
// (`vat-regime-golden`, run on every commit) holds the same engine to its golden quotes.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = process.env.PRICE_GATE_FIXTURE_DIR || path.join(__dirname, 'fixtures', 'price-gate');
const present = ['inputs.json', 'quotes.json'].every((name) => fs.existsSync(path.join(DIR, name)));
const SKIP = present ? false : 'price-gate fixture absent (captured on the price-gate-baseline tag: node scripts/price-gate/buildFixture.mjs)';

const db = require('../database');
const { calculateReservationQuote } = require('../utils/pricing');
const { compose, shape } = require('../utils/pricing/compose');
const pricingInputModel = require('../models/pricingInputModel');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const START = addDaysToIsoDate(todayIso(), 120);
const END = addDaysToIsoDate(START, 3);


let recomputed = null;
let expected = null;
if (present) {
  const inputs = JSON.parse(fs.readFileSync(path.join(DIR, 'inputs.json'), 'utf8'));
  expected = JSON.parse(fs.readFileSync(path.join(DIR, 'quotes.json'), 'utf8'));
  const { freezeClock } = require('./vatRegimeGoldenFixture');
  freezeClock(new Date(inputs.meta.capturedAt));
  const { loadInputs, quoteHashesOf } = require('../../../scripts/price-gate/recompute');
  loadInputs(db, inputs);
  recomputed = quoteHashesOf(db);
}

test('rule 4: every production stay is quoted key for key as the engine quoted it before the refactor', { skip: SKIP }, () => {
  const keyDiffs = [];
  const hashDiffs = [];
  for (const [id, want] of Object.entries(expected.stays)) {
    const got = recomputed[id];
    if (!got) { keyDiffs.push(`${id}: no quote`); continue; }
    const added = got.keys.filter((k) => !want.keys.includes(k));
    const lost = want.keys.filter((k) => !got.keys.includes(k));
    if (added.length || lost.length) keyDiffs.push(`${id}: +[${added}] -[${lost}]`);
    else if (got.hash !== want.hash) hashDiffs.push(id);
  }
  assert.deepEqual(keyDiffs, []);
  assert.deepEqual(hashDiffs, [], `the quote of stay(s) ${hashDiffs.join(', ')} changed`);
  assert.deepEqual(Object.keys(recomputed), Object.keys(expected.stays));
});

test('rule 4: the quote carries the keys the callers read (the same key set on every stay)', { skip: SKIP }, () => {
  const sets = new Set(Object.values(expected.stays).filter((s) => s.keys.length > 3).map((s) => s.keys.join(',')));
  assert.equal(sets.size, 1, 'one key set for every priced stay');
  const keys = [...sets][0].split(',');
  for (const key of ['finalPrice', 'totalStayPrice', 'depositAmount', 'balanceAmount', 'complementAmount', 'touristTaxTotal', 'optionLines', 'resourceLines', 'vatRegime', 'headline', 'summaryCascade', 'sejourNetTotal']) {
    assert.ok(keys.includes(key), key);
  }
});

test('rule 4: calculateReservationQuote is the loader, COMPOSE and nothing else', () => {
  db.prepare("INSERT INTO properties (id, name) VALUES (9001, 'Compose')").run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (9001, 'Standard', 100)").run();
  const input = { db, propertyId: 9001, startDate: START, endDate: END, adults: 2 };
  const direct = compose(pricingInputModel.load(input));
  assert.deepEqual(calculateReservationQuote(input), direct);
  assert.ok(direct.nights === 3 && direct.totalPrice === 300);
  const source = fs.readFileSync(path.join(__dirname, '..', 'utils', 'pricing.js'), 'utf8');
  const wrapper = source.slice(source.indexOf('function calculateReservationQuote'));
  assert.match(wrapper.slice(0, wrapper.indexOf('\n}\n')), /return compose\(stay\)/);
  assert.ok(!/priceStay|roundMoney\(|Math\./.test(wrapper.slice(0, wrapper.indexOf('\n}\n'))), 'no arithmetic in the wrapper');
});

test('rule 4: a stay with no night, an unknown lodging and a halted run answer as before', () => {
  const none = calculateReservationQuote({ db, propertyId: 9001, startDate: START, endDate: START, adults: 2 });
  assert.equal(none.nights, 0);
  assert.equal(none.finalPrice, 0);
  assert.deepEqual(Object.keys(none).includes('headline'), false, 'the halted quote is the short one');
  assert.deepEqual(calculateReservationQuote({ db, propertyId: 987654, startDate: START, endDate: END }), { error: 'Logement non trouvé', status: 404 });
});

test('rule 4: shape() reads the context and returns a new object', () => {
  assert.equal(typeof shape, 'function');
  assert.equal(shape.length, 1);
});

test('rule 4: the halted quote of a stay with no night, or reversed dates, is the one short literal COMPOSE shapes', () => {
  const zero = calculateReservationQuote({ db, propertyId: 9001, startDate: START, endDate: START, adults: 2 });
  const reversed = calculateReservationQuote({ db, propertyId: 9001, startDate: END, endDate: START, adults: 2 });
  assert.deepEqual(reversed, zero);
  assert.equal(Object.keys(zero).length, 44);
  assert.deepEqual(
    [zero.nights, zero.finalPrice, zero.requiredMinNights, zero.touristTaxRate, zero.defaultCheckIn, zero.defaultCheckOut, zero.vatPercentageOptions],
    [0, 0, 1, 0, '15:00', '10:00', zero.vatPercentageAccommodation],
  );
  assert.ok(zero.vatRegime && zero.property.id === 9001);
});
