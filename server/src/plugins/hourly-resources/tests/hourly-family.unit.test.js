// specs/pricing-components.md §3 rules 5 and 47 — the `hourly` article family wraps the hourly price-line contributor:
// same amounts, tagged amounts without VAT, the free minutes read as the allowance used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHourlyContributor } = require('../pricing');
const { createHourlyFamily } = require('../hourlyFamily');

const contributor = createHourlyContributor();
const family = createHourlyFamily(contributor);
const resource = {
  id: 3, name: 'Bain nordique', price: 30, priceType: 'per_hour', showsPlanningCard: 1, freeMinutes: 60,
  hourlyEveningRate: 50, hourlyEveningStart: '19:00', slotDuration: 60, openTime: '08:00', closeTime: '23:00',
};
const config = {
  id: 3, kind: 'resource', price: 30, label: 'Bain nordique', vatClass: 'resources', priceType: 'per_hour', freeMinutes: 60, resource,
};
const SESSIONS = [{ date: '2027-07-01', start: '18:00', end: '20:00' }]; // date-literal-ok: pure function input
const request = (over) => ({ ref: 'resource:3', quantity: 2, selected: { quantity: 2, sessions: SESSIONS }, sold: false, ...over });

test('rule 47 — hourly: the sessions placed are priced on the grid, the free minutes come off once', () => {
  const priced = family.price(config, request());
  const direct = contributor.priceLine({ resource, selected: { quantity: 2, sessions: SESSIONS }, sold: false });
  assert.deepEqual([priced.quantity, priced.unitPrice, priced.billedUnits], [direct.quantity, direct.unitPrice, direct.billedUnits]);
  assert.equal(priced.allowanceUsed, 60);
  assert.deepEqual(priced.extra, direct.extra);
  assert.deepEqual(priced.amounts, [{
    amountCents: Math.round(direct.totalPrice * 100), vatClass: 'resources', customerContext: 'hosted', source: { kind: 'line', ref: 'resource:3' }, docKey: 'resource:3',
  }]);
});

test('rule 47 — hourly: a sold line, or hours with no session, are a plain quantity the head bills at the lodging\'s rate', () => {
  const sold = family.price(config, request({ sold: true }));
  assert.deepEqual([sold.quantity, sold.unitPrice, sold.billedUnits, sold.amounts], [2, 30, 2, []]);
  const unplaced = family.price(config, request({ selected: { quantity: 2 } }));
  assert.deepEqual([unplaced.billedUnits, unplaced.extra.detail], [2, 'À planifier']);
});

test('rule 47 — hourly: a resource the contributor leaves to the engine is no contribution (the head prices it as without the plugin)', () => {
  const plain = { ...config, resource: { ...resource, showsPlanningCard: 0 } };
  assert.equal(family.price(plain, request({ quantity: 3 })), null);
});

test('rule 47 — hourly: validate refuses a quantity that is not a count; describe prints hours and rate', () => {
  assert.equal(family.validate(config, { quantity: -2 }).length, 1);
  assert.deepEqual(family.validate(config, { quantity: 2 }), []);
  assert.deepEqual(family.describe(config, { billedUnits: 1.5, unitPrice: 30, detail: '1 h / 2 h planifiées' }), {
    label: 'Bain nordique', detail: '1,5 h × 30,00 € · 1 h / 2 h planifiées',
  });
});

test('rule 47 — hourly: the config schema serves only the per_hour type', () => {
  const type = family.configSchema.find((entry) => entry.key === 'priceType');
  assert.equal(type.validate('per_hour'), null);
  assert.equal(typeof type.validate('per_stay'), 'string');
  for (const entry of family.configSchema) assert.equal(entry.validate(entry.default), null, entry.key);
});

test('rule 5 — the plugin declares the `hourly` family next to its price-line contributor, and asks the SDK that has it', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(source, /ctx\.priceLineContributor\(hourlyContributor\)/);
  assert.match(source, /ctx\.articleFamily\('hourly', createHourlyFamily\(hourlyContributor\)\)/);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.equal(manifest.sdk, '^2.28.0');
});
