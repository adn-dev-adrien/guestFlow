// specs/settings-input-guards.md rules 51-54 and specs/options-resources-ux.md rule 31 (audit R22, 2026-11-04) —
// what the catalogue stores reaches a stay's money: every number is judged at its route, refused never clamped;
// a stored value sent back unchanged passes; only MAX_SAFE_INTEGER is a ceiling, the business ones are not decided.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database');
const properties = require('../controllers/propertiesController');
const propertiesModel = require('../models/propertiesModel');
const options = require('../controllers/optionsController');
const optionsModel = require('../models/optionsModel');
const resources = require('../controllers/resourcesController');
const resourcesModel = require('../models/resourcesModel');
const { validatePropertyInput, seasonInputRefusal, progressivePreviewRefusal } = require('../utils/propertyValidation');
const { validateOptionPayload, priceProblem } = require('../utils/optionValidation');
const { calculateReservationQuote } = require('../utils/pricing');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const inDays = (n) => addDaysToIsoDate(todayIso(), n);
const OVER = [1e999, 1e308, 1e300, Number.MAX_SAFE_INTEGER + 2, '1e999', 'abc', true, [1], { toString: 1 }];

const text = (value) => (value && typeof value === 'object' ? JSON.stringify(value) : String(value));

function respond() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
function call(handler, params, body) {
  const res = respond();
  handler({ params, body, query: {}, user: { role: 'admin' } }, res);
  return res;
}

test.before(() => {
  db.prepare("INSERT INTO properties (id, name, maxGuests, singleBeds, doubleBeds) VALUES (1, 'Gîte fictif', 4, 0, 2)").run();
});

const seasonBody = (over = {}) => ({ label: 'Haute', pricePerNight: 100, pricingMode: 'fixed', minNights: 2, dateRanges: [{ startDate: inDays(100), endDate: inDays(110) }], ...over });
const nonFiniteRows = () => db.prepare('SELECT COUNT(*) AS n FROM pricing_rules WHERE pricePerNight > 1e15 OR pricePerNight < 0 OR minNights > 1e15 OR minNights < 1').get().n;

test('settings-input-guards rule 52: a season price, net target or minimum of nights outside the rule is refused on POST and PUT, and a stay can no longer read Infinity', () => {
  const made = call(properties.addPricing, { id: '1' }, seasonBody());
  assert.equal(made.statusCode, 200, JSON.stringify(made.body));
  const ruleId = String(made.body.id);
  const put = (over) => call(properties.updatePricing, { id: '1', ruleId }, seasonBody(over));
  const post = (over) => call(properties.addPricing, { id: '1' }, seasonBody({ dateRanges: [{ startDate: inDays(200), endDate: inDays(210) }], ...over }));
  for (const value of [...OVER, -5, -100]) {
    for (const field of ['pricePerNight', 'netTargetPerNight', 'extraGuestPrice', 'extraGuestNetTarget']) {
      for (const res of [put({ [field]: value }), post({ [field]: value })]) {
        assert.deepEqual([res.statusCode, res.body.code, res.body.field], [400, 'INVALID_SEASON', field], `${field} ${text(value)}`);
      }
    }
  }
  for (const value of [...OVER, -5, 0, 2.5]) {
    for (const res of [put({ minNights: value }), post({ minNights: value })]) {
      assert.deepEqual([res.statusCode, res.body.code, res.body.field], [400, 'INVALID_SEASON', 'minNights'], `minNights ${text(value)}`);
    }
  }
  for (const value of [...OVER, -1, 2.5]) {
    assert.deepEqual([put({ maxNights: value }).statusCode, put({ maxNights: value }).body.field], [400, 'maxNights'], `maxNights ${text(value)}`);
  }
  assert.equal(put({ seasonRank: 1e999 }).statusCode, 400);
  assert.equal(nonFiniteRows(), 0);
  const quote = calculateReservationQuote({ db, propertyId: 1, startDate: inDays(101), endDate: inDays(104), adults: 2 });
  assert.equal(quote.finalPrice, 300);
});

test('settings-input-guards rule 52: a range override and a tier table are judged too', () => {
  const body = (over) => seasonBody({ dateRanges: [{ startDate: inDays(300), endDate: inDays(310) }], ...over });
  const range = (over) => [{ startDate: inDays(300), endDate: inDays(310), ...over }];
  for (const over of [{ minNights: -5 }, { minNights: 1e300 }, { maxNights: 2.5 }]) {
    assert.equal(call(properties.addPricing, { id: '1' }, body({ dateRanges: range(over) })).statusCode, 400, JSON.stringify(over));
  }
  for (const tiers of [[{ nightNumber: 2, extraNightPrice: 1e300 }], [{ nightNumber: 2, extraNightPrice: -1 }], [{ nightNumber: 1e300, extraNightPrice: 1 }], [{ nightNumber: 2, extraNightDiscountPct: 1e300 }], JSON.stringify([{ nightNumber: 2, extraNightPrice: 1e300 }])]) {
    assert.equal(seasonInputRefusal(body({ progressiveTiers: tiers }))?.code, 'INVALID_SEASON', JSON.stringify(tiers));
  }
  for (const tiers of [[{ fromNight: 2, price: 1e300 }], [{ fromNight: 2, price: -1 }], [{ fromNight: 2, price: 5, netPrice: 1e300 }]]) {
    assert.equal(seasonInputRefusal(body({ extraGuestTiers: tiers }))?.code, 'INVALID_SEASON', JSON.stringify(tiers));
  }
  assert.equal(seasonInputRefusal(body({ progressiveTiers: [{ nightNumber: 2, extraNightPrice: 80, extraNightDiscountPct: 20 }], extraGuestTiers: [{ fromNight: 2, price: 5, netPrice: 4 }] })), null);
});

test('settings-input-guards rule 52: blank fields, 0 for a free season and an unlimited maximum still pass', () => {
  for (const over of [{ pricePerNight: 0 }, { pricePerNight: '' }, { pricePerNight: '80.5' }, { minNights: '' }, { minNights: null }, { minNights: '3' }, { maxNights: null }, { maxNights: '' }, { maxNights: 0 }, { maxNights: 400 }, { netTargetPerNight: '' }, { extraGuestPrice: null }]) {
    assert.equal(seasonInputRefusal(seasonBody(over)), null, JSON.stringify(over));
  }
});

test('settings-input-guards rule 52: what the season stores, sent back unchanged, is not re-judged; a change is', () => {
  const made = call(properties.addPricing, { id: '1' }, seasonBody({ dateRanges: [{ startDate: inDays(400), endDate: inDays(410), minNights: 5 }], extraGuestTiers: [{ fromNight: 2, price: 5 }] }));
  const ruleId = String(made.body.id);
  db.prepare('UPDATE pricing_rules SET pricePerNight = ?, minNights = ?, netTargetPerNight = ? WHERE id = ?').run(1e300, -5, -1, ruleId);
  const stored = propertiesModel.pricingRuleRow('1', ruleId);
  const back = seasonBody({ pricePerNight: 1e300, minNights: -5, netTargetPerNight: -1, dateRanges: [{ startDate: inDays(400), endDate: inDays(410), minNights: 5 }] });
  assert.equal(seasonInputRefusal(back, stored), null);
  assert.equal(seasonInputRefusal({ ...back, pricePerNight: 1e301 }, stored).field, 'pricePerNight');
  assert.equal(seasonInputRefusal({ ...back, minNights: -6 }, stored).field, 'minNights');
  db.prepare('DELETE FROM pricing_rules WHERE id = ?').run(ruleId);
  assert.equal(propertiesModel.pricingRuleRow('1', ruleId), null);
});

test('settings-input-guards rule 52: the PUT route reads the stored season, so a stored price passes and a changed one does not', () => {
  const made = call(properties.addPricing, { id: '1' }, seasonBody({ dateRanges: [{ startDate: inDays(420), endDate: inDays(430) }] }));
  const ruleId = String(made.body.id);
  db.prepare('UPDATE pricing_rules SET pricePerNight = ? WHERE id = ?').run(1e300, ruleId);
  const put = (pricePerNight) => call(properties.updatePricing, { id: '1', ruleId }, seasonBody({ pricePerNight, dateRanges: [{ startDate: inDays(420), endDate: inDays(430) }] }));
  const kept = put(1e300);
  assert.notEqual(kept.body?.code, 'INVALID_SEASON', JSON.stringify(kept.body));
  assert.deepEqual([put(1e301).statusCode, put(1e301).body.code, put(1e301).body.field], [400, 'INVALID_SEASON', 'pricePerNight']);
  db.prepare('DELETE FROM pricing_rules WHERE id = ?').run(ruleId);
});

test('settings-input-guards rule 52: text of spaces alone is not a number, an empty field is not sent', () => {
  for (const value of ['  ', '\t']) {
    assert.equal(seasonInputRefusal(seasonBody({ pricePerNight: value }))?.field, 'pricePerNight');
    assert.equal(seasonInputRefusal(seasonBody({ minNights: value }))?.field, 'minNights');
  }
  assert.equal(seasonInputRefusal(seasonBody({ pricePerNight: '', minNights: '' })), null);
});

test('settings-input-guards rule 52: assign-dates judges the new season it would create', () => {
  const body = (target, minNights = 2) => ({ startDate: inDays(500), endDate: inDays(505), minNights, target });
  for (const pricePerNight of [1e999, 1e300, -5]) {
    const res = call(properties.assignPricingDateRange, { id: '1' }, body({ mode: 'new', label: 'Neuve', pricePerNight }));
    assert.deepEqual([res.statusCode, res.body.code, res.body.field], [400, 'INVALID_SEASON', 'pricePerNight'], text(pricePerNight));
  }
  assert.equal(call(properties.assignPricingDateRange, { id: '1' }, body({ mode: 'new', label: 'Neuve', pricePerNight: 10 }, 1e300)).statusCode, 400);
  const ok = call(properties.assignPricingDateRange, { id: '1' }, body({ mode: 'new', label: 'Neuve', pricePerNight: 10 }));
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(nonFiniteRows(), 0);
});

test('settings-input-guards rule 52: a recipe apply goes through the model, unjudged, as before', () => {
  const made = propertiesModel.addPricingRule(1, seasonBody({ dateRanges: [{ startDate: inDays(600), endDate: inDays(605) }], netTargetPerNight: 90.5, seasonKey: 'haute', seasonRank: 1 }));
  assert.ok(made.data.id);
});

test('settings-input-guards rule 53: the progressive preview walks a stay\'s worth of nights at most, and one request never stops the server', () => {
  const preview = (body) => call(properties.progressivePreview, { id: '1' }, body);
  for (const maxNights of [1e999, 3000000, 100000, 367, 0, -1, 2.5, 1e308, 'abc', true, [14], '1e999']) {
    const res = preview({ pricePerNight: 10, maxNights, progressiveTiers: [] });
    assert.deepEqual([res.statusCode, res.body.field], [400, 'maxNights'], `maxNights ${text(maxNights)}`);
  }
  for (const pricePerNight of [1e999, 1e300, -1, 'abc']) {
    assert.deepEqual([preview({ pricePerNight, maxNights: 14 }).statusCode, preview({ pricePerNight, maxNights: 14 }).body.field], [400, 'pricePerNight'], text(pricePerNight));
  }
  assert.equal(preview({ pricePerNight: 10, maxNights: 14, progressiveTiers: [{ nightNumber: 2, extraNightPrice: 1e300 }] }).statusCode, 400);
  assert.equal(preview({ pricePerNight: 10, maxNights: 14, progressiveTiers: [] }).body.rows.length, 14);
  assert.equal(preview({ pricePerNight: 10, maxNights: 366, progressiveTiers: [] }).body.rows.length, 366);
  assert.equal(preview({ pricePerNight: 10, progressiveTiers: [] }).body.rows.length, 14);
  assert.equal(progressivePreviewRefusal({ pricePerNight: '', maxNights: '14' }), null);
});

const PROPERTY_FIELDS = ['maxBabies', 'singleBeds', 'doubleBeds', 'basePriceIncludedGuests', 'extraGuestPrice', 'touristTaxPerDayPerPerson', 'touristTaxFixedAmount', 'defaultCautionAmount', 'welcomePackCost', 'cleaningHours', 'parkingDistanceMeters', 'maxGuests'];

test('settings-input-guards rule 51: every number of a property is judged, with the deposit off too', () => {
  for (const key of PROPERTY_FIELDS) {
    for (const value of [1e999, 1e308, 1e300, 'abc', true, [1], { toString: 1 }, -1, '1e999']) {
      assert.ok(validatePropertyInput({ [key]: value }, null)[key], `${key} ${text(value)}`);
    }
  }
  for (const depositPercent of [1e999, 1e308, -1, 101, 'abc']) {
    assert.ok(validatePropertyInput({ depositEnabled: 0, depositPercent }, null).depositPercent, text(depositPercent));
  }
  assert.ok(validatePropertyInput({ depositEnabled: 1, depositPercent: 1e999 }, null).depositPercent);
});

test('settings-input-guards rule 51: the PUT route answers PROPERTY_INVALID and stores nothing', async () => {
  const before = db.prepare('SELECT cleaningHours FROM properties WHERE id = 1').get().cleaningHours;
  const res = respond();
  await properties.update({ params: { id: '1' }, body: { name: 'Gîte fictif', cleaningHours: 1e999 }, query: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'PROPERTY_INVALID');
  assert.ok(res.body.errors.cleaningHours);
  assert.equal(db.prepare('SELECT cleaningHours FROM properties WHERE id = 1').get().cleaningHours, before);
});

test('settings-input-guards rule 51: blanks and multipart strings stay readable, half an hour of cleaning stays allowed', () => {
  const body = { cleaningHours: '2,5', parkingDistanceMeters: '', welcomePackCost: ' ', depositEnabled: '0', depositPercent: '', touristTaxPerDayPerPerson: '1.5', extraGuestPrice: '0', defaultCautionAmount: '', maxBabies: '1', singleBeds: '0', doubleBeds: '2' };
  assert.deepEqual(validatePropertyInput(body, null), {});
});

test('settings-input-guards rule 51: a stored number sent back unchanged is not re-judged', () => {
  const stored = { cleaningHours: -2, welcomePackCost: 1e300, parkingDistanceMeters: 1e300, depositEnabled: 0, depositPercent: 1e300, maxBabies: 1e300, singleBeds: 1e300, doubleBeds: 1, maxGuests: 2, touristTaxFixedAmount: 1e300, extraGuestPrice: 1e300, basePriceIncludedGuests: 2 };
  const { maxGuests, singleBeds, doubleBeds, ...rest } = stored; // eslint-disable-line no-unused-vars
  assert.deepEqual(validatePropertyInput(rest, stored), {});
  assert.ok(validatePropertyInput({ cleaningHours: -3 }, stored).cleaningHours);
});

const optionBody = (over = {}) => ({ title: 'Bois', priceType: 'per_stay', price: 10, ...over });

test('options-resources-ux rule 31: an option\'s towels, price, property prices, bath mats and participant tiers stop at the usable range', () => {
  const made = optionsModel.create(optionBody());
  const id = String(made.id);
  const refused = (over) => {
    const res = call(options.update, { id }, optionBody(over));
    assert.equal(res.statusCode, 422, JSON.stringify(over).slice(0, 80));
    assert.equal(res.body.error, 'VALIDATION_FAILED');
    return res.body.details[0].field;
  };
  for (const value of [1e999, 1e308, -1, 1.5, 'abc']) {
    for (const field of ['towelLargePerPerson', 'towelMediumPerPerson', 'towelSmallPerPerson']) assert.equal(refused({ [field]: value }), field, `${field} ${text(value)}`);
  }
  for (const price of [1e999, 1e308]) assert.equal(refused({ price }), 'price');
  assert.equal(refused({ propertyPrices: { 1: 1e308 } }), 'propertyPrices.1');
  assert.equal(refused({ propertyBathMats: { 1: 1e308 } }), 'propertyBathMats.1');
  assert.equal(refused({ optionProgressiveTiers: [{ participantNumber: 1, unitPrice: 1e308 }] }), 'optionProgressiveTiers');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options WHERE price > 1e15 OR towelLargePerPerson > 1e15').get().n, 0);
  assert.equal(call(options.update, { id }, optionBody({ towelLargePerPerson: 2, price: '12.50', propertyPrices: { 1: '' } })).statusCode, 200);
});

test('options-resources-ux rule 31: a stored option number sent back unchanged is not re-judged', () => {
  const stored = { price: 1e300, towelLargePerPerson: 1e300, propertyPrices: { 1: 1e300 }, propertyBathMats: { 1: 1e300 }, optionProgressiveTiers: [{ participantNumber: 1, unitPrice: 1e300 }] };
  const back = { ...optionBody(), ...stored };
  assert.deepEqual(validateOptionPayload(back, { stored }), []);
  assert.equal(priceProblem(1e301, { stored: 1e300 }), 'Nombre attendu');
  assert.equal(priceProblem('', {}), '');
  assert.equal(priceProblem([5]), 'Nombre attendu');
  assert.equal(priceProblem(1.234), '2 décimales max');
});

const resourceBody = (over = {}) => ({ name: 'Vélo', quantity: 2, price: 5, priceType: 'per_stay', ...over });

test('options-resources-ux rule 31: a resource\'s durations, prices, rates and quantity stop at the usable range', () => {
  const id = String(resourcesModel.insert(resourceBody()));
  const refused = (over) => {
    const res = call(resources.update, { id }, resourceBody(over));
    assert.equal(res.statusCode, 422, JSON.stringify(res.body).slice(0, 120) + JSON.stringify(over).slice(0, 80));
    return res.body.details.map((d) => d.field);
  };
  for (const value of [1e999, 1e308, -1, 'abc']) {
    for (const field of ['slotDuration', 'turnoverMinutes', 'minimumUsageMinutes', 'heatUpMinutes', 'heatRetentionMinutes']) {
      assert.deepEqual(refused({ [field]: value }), [field], `${field} ${text(value)}`);
    }
  }
  for (const value of [1e999, 1e308]) {
    for (const field of ['price', 'hourlyEveningRate', 'hourlyExternalDayRate', 'hourlyExternalEveningRate']) assert.deepEqual(refused({ [field]: value }), [field], `${field} ${text(value)}`);
    assert.deepEqual(refused({ quantity: value }), ['quantity']);
    assert.deepEqual(refused({ propertyPricing: { 1: { price: value } } }), ['propertyPricing.1']);
    assert.deepEqual(refused({ propertyPricing: { 1: { price: 5, freeMinutes: value } } }), ['propertyPricing.1.freeMinutes']);
    assert.deepEqual(refused({ propertyPrices: { 1: value } }), ['propertyPrices.1']);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM resources WHERE slotDuration > 1e15 OR price > 1e15 OR quantity > 1e15 OR heatUpMinutes > 1e15').get().n, 0);
  const ok = call(resources.update, { id }, resourceBody({ slotDuration: '30', turnoverMinutes: 0, heatUpMinutes: '', hourlyEveningRate: '', propertyPricing: { 1: { price: '', freeMinutes: 60 } } }));
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
});

test('options-resources-ux rule 31: a stored resource number sent back unchanged is not re-judged', () => {
  const id = Number(resourcesModel.insert(resourceBody()));
  db.prepare('UPDATE resources SET turnoverMinutes = ?, price = ?, quantity = ? WHERE id = ?').run(-5, 1e300, 1e300, id);
  const res = call(resources.update, { id: String(id) }, resourceBody({ turnoverMinutes: -5, price: 1e300, quantity: 1e300 }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const changed = call(resources.update, { id: String(id) }, resourceBody({ turnoverMinutes: -6, price: 1e300, quantity: 1e300 }));
  assert.equal(changed.statusCode, 422);
});
