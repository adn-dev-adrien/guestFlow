// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 2, 28 — the price checks judge the stored resource under the payload: a partial save cannot slip a bad price in
// by leaving out the keys that switch the check on; a per-lodging price on an hourly resource of the planning is refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const { optionalPlugin, requirePlugins } = require('../plugins/sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;
const { validateHourlyRates } = optionalPlugin(() => require('../plugins/hourly-resources/resourceRates'));

const STORED = {
  priceType: 'per_hour', showsPlanningCard: 1, sellableExternally: 1, hourlyEveningStart: '19:00',
  price: 30, hourlyNextDayRate: 30, hourlyEveningRate: 40, hourlyNextEveningRate: 40,
  hourlyExternalDayRate: 50, hourlyExternalNextDayRate: 50, hourlyExternalEveningRate: 70, hourlyExternalNextEveningRate: 70,
  hourlyExternalWeekendDayRate: 70, hourlyExternalWeekendNextDayRate: 70, hourlyExternalWeekendEveningRate: 90, hourlyExternalWeekendNextEveningRate: 90,
};
const fields = (details) => details.map((d) => d.field);

test('a partial save of one price is judged on the whole resource: -50, "abc" and 99999 are refused without the switches in the payload', () => {
  [-50, 'abc', 99999, ''].forEach((bad) => {
    assert.deepEqual(fields(validateHourlyRates({ hourlyExternalDayRate: bad }, STORED)), ['hourlyExternalDayRate'], String(bad));
    assert.deepEqual(fields(validateHourlyRates({ price: bad }, STORED)), ['price'], String(bad));
  });
});

test('a partial save that sends nothing wrong stays accepted, and a save of a resource sold outside refuses an outside 0', () => {
  assert.deepEqual(validateHourlyRates({ name: 'Bain' }, STORED), []);
  assert.deepEqual(fields(validateHourlyRates({ hourlyExternalEveningRate: 0 }, STORED)), ['hourlyExternalEveningRate']);
  assert.deepEqual(validateHourlyRates({ sellableExternally: 0, hourlyExternalEveningRate: 0 }, STORED), []);
});

test('a price per lodging on an hourly resource of the planning is refused; its free minutes are not', () => {
  assert.deepEqual(fields(validateHourlyRates({ propertyPricing: { 3: { price: 12, freeMinutes: 60 } } }, STORED)), ['propertyPricing.3']);
  assert.deepEqual(validateHourlyRates({ propertyPricing: { 3: { price: null, freeMinutes: 60 } } }, STORED), []);
  assert.deepEqual(validateHourlyRates({ propertyPricing: { 3: { price: 12 } } }, { ...STORED, showsPlanningCard: 0 }), []);
});
