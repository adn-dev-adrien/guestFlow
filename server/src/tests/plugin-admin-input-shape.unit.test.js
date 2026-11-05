// specs/plugins-phase-1-sdk.md rule 7, reading of 2026-11-04 (audit R22-P2) — the plugin admin routes answer their own
// 400 to a wrong-shape body. The plugins are installed and switched on: each refusal comes from the route, not from the
// plugin gate. A plugin absent from the tree has no row to judge (plugin-removal-resilience).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./inputShapeApp');

const T = JSON.parse('{"toString":1}');
const PLUGINS = ['hourly-resources', 'school-holidays', 'tariff-recipes', 'accounting-export', 'neat'];
let app;
let admin;
let active = new Set();

test.before(async () => {
  app = await startApp();
  admin = await app.login('admin@shape.test');
  active = await app.activatePlugins(admin, PLUGINS);
});
test.after(async () => { if (app) await app.stop(); });

const refused = async (method, url, body) => {
  const mark = app.logMark();
  const res = await app.call(admin, method, url, body);
  assert.doesNotMatch(app.logSince(mark), /\[unhandled\]/, `${method} ${url} ${JSON.stringify(body)}`);
  assert.equal(res.status, 400, `${method} ${url} ${JSON.stringify(body)} → ${res.status} ${res.text.slice(0, 160)}`);
  return res;
};

test('hourly-resources — a resource card takes a real tick, and scalar ids', async (t) => {
  if (!active.has('hourly-resources')) return t.skip('not in this tree');
  const good = { reservationId: app.ids.reservation, resourceId: 1, date: app.dates.start, start: '09:00' };
  for (const patch of [
    { reservationId: T }, { reservationId: [1] }, { resourceId: T }, { resourceId: true }, { date: T }, { date: ['x'] }, { start: T }, { start: 9 },
    { done: 'false' }, { done: 'abc' }, { done: T }, { done: {} }, { done: 2 },
  ]) {
    const res = await refused('POST', '/api/planning/resource-cards/done', { ...good, ...patch });
    assert.equal(res.json.error, 'INVALID_PAYLOAD', JSON.stringify(patch));
  }
  const { reservation } = app.ids;
  const repeated = await app.call(admin, 'GET', `/api/resources/1/free-slots?reservationId=${reservation}&reservationId=${reservation}`);
  assert.equal(repeated.status, 404);
  assert.equal(repeated.json.error, 'RESERVATION_NOT_FOUND');
});

test('school-holidays — a label that is not text is « obligatoire », on POST and PUT, and nothing is stored', async (t) => {
  if (!active.has('school-holidays')) return t.skip('not in this tree');
  const zone = { zoneA_start: app.dates.start, zoneA_end: app.dates.end };
  const created = await app.call(admin, 'POST', '/api/school-holidays', { label: 'vacances de test', ...zone });
  assert.equal(created.status, 200, created.text);
  const { id } = created.json;
  const url = `/api/school-holidays/${id}`;
  const labels = () => app.readDb('SELECT id, label FROM school_holidays ORDER BY id');
  const before = labels();
  assert.deepEqual(before.filter((row) => row.id === id).map((row) => row.label), ['Vacances de test'], 'text still takes its capital');
  for (const label of [T, { a: 1 }, {}, ['x'], [], 1, true]) {
    for (const [method, target] of [['POST', '/api/school-holidays'], ['PUT', url]]) {
      const res = await refused(method, target, { label, ...zone });
      assert.equal(res.json.code, 'INVALID_PERIOD', `${method} ${JSON.stringify(label)}`);
      assert.match(res.json.error, /libellé/, `${method} ${JSON.stringify(label)}`);
    }
  }
  assert.deepEqual(labels(), before);
});

test('tariff-recipes — recipe id and journal fields', async (t) => {
  if (!active.has('tariff-recipes')) return t.skip('not in this tree');
  for (const recipeId of [T, ['gite'], 1, true]) {
    const res = await refused('POST', `/api/properties/${app.ids.property}/tariff-recipe/apply`, { recipeId });
    assert.equal(res.json.error, 'recipeId requis', JSON.stringify(recipeId));
  }
  const events = () => app.readDb('SELECT COUNT(*) AS n FROM tariff_change_events')[0].n;
  const before = events();
  for (const body of [{ propertyId: T, kind: 'x' }, { propertyId: true, kind: 'x' }, { propertyId: app.ids.property, kind: T }, { propertyId: app.ids.property, kind: 'x', note: T }, { propertyId: app.ids.property, kind: 'x', occurredAt: {} }]) {
    const res = await refused('POST', '/api/tariff-recipes/journal', body);
    assert.equal(res.json.error, 'Valeur invalide.', JSON.stringify(body));
  }
  assert.equal(events(), before);
});

test('accounting-export — each account, rate and platform line is its field\'s refusal', async (t) => {
  if (!active.has('accounting-export')) return t.skip('not in this tree');
  const base = { defaultAccount: '622600' };
  for (const [patch, field] of [
    [{ defaultAccount: T }, 'defaultAccount'], [{ defaultAccount: {} }, 'defaultAccount'],
    [{ cancellationCompensationAccount: T }, 'cancellationCompensationAccount'],
    [{ vatRateCommission: T }, 'vatRateCommission'], [{ vatRateCommission: [] }, 'vatRateCommission'],
    [{ plan: { journalCode: T } }, 'journalCode'], [{ plan: { journalCode: {} } }, 'journalCode'],
    [{ platforms: [null] }, 'account'], [{ platforms: [1] }, 'account'], [{ platforms: [{ id: 1, account: T }] }, 'account'],
  ]) {
    const res = await refused('PUT', '/api/accounting/platform-accounts', { ...base, ...patch });
    assert.ok(JSON.stringify(res.json).includes(`"${field}"`), `${JSON.stringify(patch)} → ${res.text.slice(0, 200)}`);
  }
  for (const [key, value] of [['defaultCommissionAccountNumber', T], ['journalCode', ['VT']], ['vatRateCommission', { a: 1 }]]) {
    const res = await refused('PUT', '/api/plugins/accounting-export/settings', { [key]: value });
    assert.equal(res.json.error, 'INVALID_SETTING', `${key} ${res.text.slice(0, 200)}`);
  }
});

test('neat — credentials are text: nothing stored, the margin refused', async (t) => {
  if (!active.has('neat')) return t.skip('not in this tree');
  for (const [body, field] of [
    [{ environment: T }, 'environment'], [{ environment: ['staging'] }, 'environment'],
    [{ clientId: T }, 'clientId'], [{ clientId: { a: 1 } }, 'clientId'], [{ clientSecret: T }, 'clientSecret'], [{ clientSecret: { a: 1 } }, 'clientSecret'],
    [{ marginPercent: T }, 'marginPercent'], [{ marginPercent: [1] }, 'marginPercent'],
  ]) {
    const res = await refused('PUT', '/api/neat/settings', body);
    assert.equal(res.json.code, 'SETTINGS_INVALID', JSON.stringify(body));
    assert.ok(res.json.errors[field], field);
  }
  const [row] = app.readDb('SELECT neatClientId, neatClientSecretEncrypted FROM app_settings LIMIT 1');
  assert.ok(!row.neatClientId, 'no client id stored');
  assert.ok(!row.neatClientSecretEncrypted, 'no secret stored');
});
