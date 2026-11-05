// specs/options-resources-ux.md rule 32 (audit R23-A2) — the catalogue's closed values: a price type, an automatic type,
// a pricing mode, an hour and a property list, a stored value sent back exempt, the editors' own payloads accepted.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./inputShapeApp');
const { validateOptionPayload } = require('../utils/optionValidation');

const T = JSON.parse('{"toString":1}');
let app;
let admin;
test.before(async () => {
  app = await startApp();
  admin = await app.login('admin@shape.test');
  await app.activatePlugins(admin, ['hourly-resources']);
});
test.after(async () => { if (app) await app.stop(); });

const option = { title: 'O', price: 1, priceType: 'per_stay' };
const resource = { name: 'R', quantity: 1, price: 1, priceType: 'per_stay' };

test('rule 32 — an option: unknown or wrong-typed closed values are 422, each on its field', async () => {
  const cases = {
    priceType: ['bogus', T, {}, [], true, -1],
    autoOptionType: ['bogus', T, {}, [], true, -1],
    autoPricingMode: ['bogus', T, {}, [], true, -1],
    autoFullNightThreshold: ['bogus', '99:99', T, {}, [], true, -1],
    category: [T, {}, [], true, -1],
    propertyIds: [T, {}, true, 1.5, -1, 1e308, 'x', ['x'], [-1], [1.5]],
  };
  for (const [field, values] of Object.entries(cases)) {
    for (const value of values) {
      const res = await app.call(admin, 'POST', '/api/options', { ...option, [field]: value });
      assert.equal(res.status, 422, `${field} ${JSON.stringify(value)} → ${res.status} ${res.text.slice(0, 120)}`);
      assert.equal(res.json.details[0].field, field);
    }
  }
});

test('rule 32 — an option: every value the editors send still passes, a stored one exempt', async () => {
  const types = ['per_stay', 'per_person', 'per_night', 'per_person_per_night', 'per_participant_progressive', 'percent_of_stay', 'free'];
  for (const priceType of types) assert.equal((await app.call(admin, 'POST', '/api/options', { ...option, priceType })).status, 200, priceType);
  for (const autoOptionType of ['early_check_in', 'late_check_out', null, '']) {
    const res = await app.call(admin, 'POST', '/api/options', { ...option, autoOptionType, autoPricingMode: 'proportional', autoFullNightThreshold: '10:00', category: '', propertyIds: [app.ids.property] });
    assert.equal(res.status, 200, res.text);
  }
  const stored = { priceType: 'per_day', autoOptionType: 'legacy', autoPricingMode: 'legacy', autoFullNightThreshold: '25:00' };
  assert.deepEqual(validateOptionPayload({ title: 'O', ...stored }, { stored }), []);
  const list = (await app.call(admin, 'GET', '/api/options')).json;
  const breakfast = list.find((o) => o.autoOptionType);
  if (breakfast) assert.equal((await app.call(admin, 'PUT', `/api/options/${breakfast.id}`, breakfast)).status, 200, 'a whole stored row sent back passes');
});

test('rule 32 — a resource: closed values and hours are judged, a stored one exempt', async () => {
  const cases = {
    priceType: ['bogus', T, {}, [], true, -1],
    openTime: ['99:99', 'x', T, {}, [], true, 8],
    closeTime: ['99:99', 'x', T, {}, [], true, 22],
    hourlyEveningStart: ['99:99', T, {}, [], true, 18],
    openDays: ['x', '[9]', '{}', T, {}, true, 3, [8], ['x']],
    name: [T, {}, [], true, 5],
    note: [T, {}, [], true, 5],
    emailBookedText: [T, {}, [], true, 5],
    emailBookedTextEn: [T, {}, [], true, 5],
  };
  for (const [field, values] of Object.entries(cases)) {
    for (const value of values) {
      const res = await app.call(admin, 'POST', '/api/resources', { ...resource, [field]: value });
      assert.equal(res.status, 422, `${field} ${JSON.stringify(value)} → ${res.status} ${res.text.slice(0, 120)}`);
      assert.equal(res.json.details[0].field, field);
    }
  }
  const made = await app.call(admin, 'POST', '/api/resources', { ...resource, priceType: 'per_hour', isComplex: 1, openTime: '08:00', closeTime: '22:00', openDays: '[0,1,2]', hourlyEveningStart: '18:00', minimumUsageMinutes: 60 });
  assert.equal(made.status, 200, made.text);
  assert.equal((await app.call(admin, 'POST', '/api/resources', { ...resource, openDays: [1, 2], hourlyEveningStart: null, openTime: '', closeTime: '' })).status, 200);
  const row = (await app.call(admin, 'GET', `/api/resources/${made.json.id}`)).json;
  assert.equal((await app.call(admin, 'PUT', `/api/resources/${made.json.id}`, row)).status, 200, 'a whole stored row sent back passes');
});
