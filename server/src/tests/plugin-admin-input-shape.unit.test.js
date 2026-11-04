// specs/plugins-phase-1-sdk.md rule 7, reading of 2026-11-04 (audit R22-P2) — the plugin admin routes answer their own
// 400 to a wrong-shape body. A plugin absent from the tree answers 404: its row is not judged (plugin-removal-resilience).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./inputShapeApp');

const T = JSON.parse('{"toString":1}');
let app;
let admin;

test.before(async () => {
  app = await startApp();
  admin = await app.login('admin@shape.test');
});
test.after(async () => { if (app) await app.stop(); });

const refused = async (method, url, body) => {
  const res = await app.call(admin, method, url, body);
  if (res.status === 404 && res.json && /PLUGIN|not found/i.test(String(res.json.error))) return null;
  assert.ok(res.status >= 400 && res.status < 500, `${method} ${url} ${JSON.stringify(body)} → ${res.status} ${res.text.slice(0, 120)}`);
  return res;
};

test('hourly-resources — a resource card takes a real tick, and scalar ids', async () => {
  const good = { reservationId: app.ids.reservation, resourceId: 1, date: app.dates.start, start: '09:00' };
  for (const patch of [
    { reservationId: T }, { reservationId: [1] }, { resourceId: T }, { resourceId: true }, { date: T }, { date: ['x'] }, { start: T }, { start: 9 },
    { done: 'false' }, { done: 'abc' }, { done: T }, { done: {} }, { done: 2 },
  ]) {
    const res = await refused('POST', '/api/planning/resource-cards/done', { ...good, ...patch });
    if (res) assert.equal(res.json.error, 'INVALID_PAYLOAD', JSON.stringify(patch));
  }
  const repeated = await app.call(admin, 'GET', `/api/resources/1/free-slots?reservationId=${app.ids.reservation}&reservationId=${app.ids.reservation}`);
  assert.ok(repeated.status < 500, String(repeated.status));
});

test('school-holidays — a label that is not text is « obligatoire »', async () => {
  for (const label of [T, {}, [], 1, true]) {
    const res = await refused('POST', '/api/school-holidays', { label });
    if (res) assert.match(res.json.error, /libellé/);
  }
});

test('tariff-recipes — recipe id and journal fields', async () => {
  for (const recipeId of [T, ['gite'], 1, true]) {
    const res = await refused('POST', `/api/properties/${app.ids.property}/tariff-recipe/apply`, { recipeId });
    if (res) assert.equal(res.json.error, 'recipeId requis');
  }
  for (const body of [{ propertyId: T, kind: 'x' }, { propertyId: true, kind: 'x' }, { propertyId: app.ids.property, kind: T }, { propertyId: app.ids.property, kind: 'x', note: T }, { propertyId: app.ids.property, kind: 'x', occurredAt: {} }]) {
    await refused('POST', '/api/tariff-recipes/journal', body);
  }
});

test('accounting-export — each account, rate and platform line is its field\'s refusal', async () => {
  const base = { defaultAccount: '622600' };
  for (const [patch, field] of [
    [{ defaultAccount: T }, 'defaultAccount'], [{ defaultAccount: {} }, 'defaultAccount'],
    [{ cancellationCompensationAccount: T }, 'cancellationCompensationAccount'],
    [{ vatRateCommission: T }, 'vatRateCommission'], [{ vatRateCommission: [] }, 'vatRateCommission'],
    [{ plan: { journalCode: T } }, 'plan'], [{ platforms: [null] }, 'platforms'], [{ platforms: [1] }, 'platforms'], [{ platforms: [{ id: 1, account: T }] }, 'platforms'],
  ]) {
    const res = await refused('PUT', '/api/accounting/platform-accounts', { ...base, ...patch });
    if (res) {
      assert.equal(res.status, 400, JSON.stringify(patch));
      assert.ok(JSON.stringify(res.json).includes(field) || res.json.errors || res.json.error, JSON.stringify(res.json));
    }
  }
});

test('neat — credentials are text: nothing stored, the margin refused', async () => {
  for (const [body, field] of [
    [{ environment: T }, 'environment'], [{ environment: ['staging'] }, 'environment'],
    [{ clientId: T }, 'clientId'], [{ clientId: { a: 1 } }, 'clientId'], [{ clientSecret: T }, 'clientSecret'], [{ clientSecret: { a: 1 } }, 'clientSecret'],
    [{ marginPercent: T }, 'marginPercent'], [{ marginPercent: [1] }, 'marginPercent'],
  ]) {
    const res = await refused('PUT', '/api/neat/settings', body);
    if (res) {
      assert.equal(res.json.code, 'SETTINGS_INVALID', JSON.stringify(body));
      assert.ok(res.json.errors[field], field);
    }
  }
  const [row] = app.readDb('SELECT neatClientId, neatClientSecretEncrypted FROM app_settings LIMIT 1');
  assert.ok(!row || !String(row.neatClientId || '').includes('object'));
});
