// specs/options-resources-ux.md rule 19 — what the hourly plugin adds to a resource's card.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCatalogueLines } = require('../catalogueLines');

const PROPS = [{ id: 1, name: 'Granja' }, { id: 2, name: 'Estiva' }];
const bath = (over = {}) => ({
  priceType: 'per_hour', isComplex: 1, openTime: '11:00', closeTime: '22:00', minimumUsageMinutes: 60,
  turnoverMinutes: 15, showsPlanningCard: 1, hourlyEveningStart: '20:00', hourlyEveningRate: 50,
  hourlyExternalDayRate: 50, hourlyExternalEveningRate: 70, propertyPricing: {}, ...over,
});

test('rule 19: a resource not sold by the hour gets nothing', () => {
  assert.equal(buildCatalogueLines({ priceType: 'per_stay' }, { properties: PROPS }), null);
  assert.equal(buildCatalogueLines(null), null);
});

test('rule 19: the evening and external rates and the footer of the nordic bath', () => {
  const { lines, footer } = buildCatalogueLines(bath(), { properties: PROPS });
  assert.deepEqual(lines, [
    { label: 'Soir', value: '50 € / h après 20:00' },
    { label: 'Extérieurs', value: '50 € / h · soir 70 € / h' },
  ]);
  assert.equal(footer, 'À l’heure · 11:00–22:00 · 1 h minimum · remise en état 15 min · carte au planning');
});

test('rule 19: no evening start or no rate, no evening line; only the rates that exist are listed', () => {
  const { lines } = buildCatalogueLines(bath({ hourlyEveningStart: null, hourlyExternalDayRate: 0 }), { properties: PROPS });
  assert.deepEqual(lines, [{ label: 'Extérieurs', value: 'soir 70 € / h' }]);
  assert.deepEqual(buildCatalogueLines(bath({ hourlyEveningRate: 0, hourlyExternalDayRate: 0, hourlyExternalEveningRate: 0 }), { properties: PROPS }).lines, []);
});

test('rule 19: the free first hour names the properties, « tous les logements » when it is all of them', () => {
  const some = buildCatalogueLines(bath({ propertyPricing: { 1: { price: 30, freeMinutes: 60 } } }), { properties: PROPS });
  assert.deepEqual(some.lines.at(-1), { label: 'Offert', value: '1re heure · Granja' });
  const all = buildCatalogueLines(bath({ propertyPricing: { 1: { price: 30, freeMinutes: 60 }, 2: { price: 30, freeMinutes: 60 } } }), { properties: PROPS });
  assert.equal(all.lines.at(-1).value, '1re heure · tous les logements');
  const other = buildCatalogueLines(bath({ propertyPricing: { 2: { price: 30, freeMinutes: 30 } } }), { properties: PROPS });
  assert.equal(other.lines.at(-1).value, '30 min offertes · Estiva');
});

test('rule 19: the footer drops what the resource does not have', () => {
  const { footer } = buildCatalogueLines(bath({ isComplex: 0, turnoverMinutes: 0, showsPlanningCard: 0, minimumUsageMinutes: 90 }), { properties: PROPS });
  assert.equal(footer, 'À l’heure · 1 h 30 minimum');
});
