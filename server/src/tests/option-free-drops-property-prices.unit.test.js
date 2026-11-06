// specs/options-resources-ux.md rule 35 (audit R26-DB-1, 2026-11-06) — through the real application: an option saved as « free »
// (or per-participant progressive) holds no per-logement price, whether the body sends `propertyPrices` or not, so the quote
// stops billing the old one at once. A row holding free units keeps the tariff
// recipes' free-units refusal (422), nothing written.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./inputShapeApp');
const { scopePayload } = require('../utils/optionPayloadScope');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const dayAt = (n) => addDaysToIsoDate(todayIso(), n);
const writeDb = (sql, ...params) => {
  const Database = require('better-sqlite3');
  const rw = new Database(app.dbPath);
  try { rw.prepare(sql).run(...params); } finally { rw.close(); }
};

let app;
let admin;
let property;

test.before(async () => {
  app = await startApp();
  admin = await app.login('admin@shape.test');
  const created = await app.call(admin, 'POST', '/api/properties', { name: 'Cabane', maxGuests: 2, maxBabies: 1, doubleBeds: 1, singleBeds: 0, pricePerNight: 80 });
  assert.equal(created.status, 200, created.text);
  property = created.json.id;
  const [season] = app.readDb('SELECT id FROM pricing_rules WHERE propertyId = ?', property);
  const priced = await app.call(admin, 'PUT', `/api/properties/${property}/pricing/${season.id}`, {
    label: 'Tarif', pricePerNight: 80, startDate: dayAt(1), endDate: dayAt(90), minNights: 1, color: '#112233', pricingMode: 'fixed',
  });
  assert.equal(priced.status, 200, priced.text);
});
test.after(async () => { if (app) await app.stop(); });

async function pricedOption(title) {
  const res = await app.call(admin, 'POST', '/api/options', {
    title, price: 4, priceType: 'per_stay', propertyIds: [property], propertyPrices: { [property]: 10 }, displayToClient: true,
  });
  assert.equal(res.status, 200, res.text);
  return Number(res.json.id);
}
const pricesOf = (id) => app.readDb('SELECT propertyId, price, freeUnits FROM property_option_prices WHERE optionId = ?', id);
async function billed(id) {
  const res = await app.call(admin, 'POST', '/api/reservations/calculate-price', {
    propertyId: property, startDate: dayAt(20), endDate: dayAt(22), checkInTime: '16:00', checkOutTime: '10:00', platform: 'direct',
    adults: 2, children: 0, teens: 0, babies: 0, selectedOptions: [{ optionId: id, quantity: 1 }], customOptions: [], selectedResources: [],
    discountPercent: 0, customPrice: '',
  });
  assert.equal(res.status, 200, res.text);
  return (res.json.optionLines || []).filter((l) => Number(l.optionId) === id).map((l) => l.totalPrice);
}

test('« free » without propertyPrices: the per-logement price goes, the quote bills 0', async () => {
  const id = await pricedOption('Planche gratuite');
  assert.deepEqual(await billed(id), [10]);
  const res = await app.call(admin, 'PUT', `/api/options/${id}`, { title: 'Planche gratuite', priceType: 'free' });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(pricesOf(id), []);
  assert.deepEqual(await billed(id), [0]);
});

test('« free » without propertyPrices, propertyIds sent: same', async () => {
  const id = await pricedOption('Bois offert');
  const res = await app.call(admin, 'PUT', `/api/options/${id}`, { title: 'Bois offert', priceType: 'free', propertyIds: [property] });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(pricesOf(id), []);
  assert.deepEqual(await billed(id), [0]);
});

test('per-participant progressive without propertyPrices: the per-logement price goes', async () => {
  const id = await pricedOption('Atelier');
  const res = await app.call(admin, 'PUT', `/api/options/${id}`, {
    title: 'Atelier', priceType: 'per_participant_progressive', optionProgressiveTiers: [{ fromParticipant: 1, unitPrice: 5 }],
  });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(pricesOf(id), []);
});

test('a row holding free units: « free » without propertyPrices is the free-units refusal, nothing written', async () => {
  const id = await pricedOption('Petit déjeuner offert');
  writeDb('UPDATE property_option_prices SET freeUnits = 2 WHERE optionId = ?', id);
  const res = await app.call(admin, 'PUT', `/api/options/${id}`, { title: 'Petit déjeuner offert', priceType: 'free' });
  assert.equal(res.status, 422, res.text);
  assert.deepEqual(res.json.details, [{ field: `propertyPrices.${property}`, message: 'Prix requis : unités offertes ici (0 € accepté)' }]);
  assert.deepEqual(pricesOf(id), [{ propertyId: property, price: 10, freeUnits: 2 }]);
  assert.equal(app.readDb('SELECT priceType FROM options WHERE id = ?', id)[0].priceType, 'per_stay');
});

test('a priced type without propertyPrices keeps the stored per-logement price', async () => {
  const id = await pricedOption('Panier');
  const res = await app.call(admin, 'PUT', `/api/options/${id}`, { title: 'Panier', priceType: 'per_person' });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(pricesOf(id), [{ propertyId: property, price: 10, freeUnits: 0 }]);
});

test('scopePayload: a type with no per-logement price empties propertyPrices, sent or not', () => {
  assert.deepEqual(scopePayload({ priceType: 'free', propertyIds: [1] }).propertyPrices, {});
  assert.deepEqual(scopePayload({ priceType: 'free', propertyIds: [1], propertyPrices: { 1: 9 } }).propertyPrices, {});
  assert.equal(scopePayload({ priceType: 'per_stay', propertyIds: [1] }).propertyPrices, undefined);
});
