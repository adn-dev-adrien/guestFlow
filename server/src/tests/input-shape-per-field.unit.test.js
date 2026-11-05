// specs/hosting-h2-account-security.md rule 68, reading of 2026-11-05 (audit R23-A2, R23-A3, section 4 of the audit) — the whole
// route set from a valid baseline, one field wrong at a time, through the real application: no 5xx, no `[unhandled]` line, no
// wrong type stored as text. Each baseline must reach its fields: a row refused on its own would prove nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./inputShapeApp');
const { baselines, fuzzRow, junkScanner, dayAt } = require('./inputShapeBaselines');

const T = JSON.parse('{"toString":1}');
const VALUES = [['T', T], ['obj', { a: 1 }], ['true', true], ['huge', 1e308], ['null', null]];
const PLUGINS = ['hourly-resources', 'school-holidays', 'tariff-recipes', 'accounting-export', 'neat', 'online-payment', 'sas', 'linen'];

let app;
let admin;
let active;
let rows;
let scanner;

test.before(async () => {
  app = await startApp();
  admin = await app.login('admin@shape.test');
  active = await app.activatePlugins(admin, PLUGINS);
  ({ rows } = await baselines(app, admin, active));
  rows = rows.filter(([, , , options = {}]) => !options.plugin || active.has(options.plugin));
  scanner = junkScanner(app.dbPath);
});
test.after(async () => {
  if (scanner) scanner.close();
  if (app) await app.stop();
});

test('rule 68 — every baseline is accepted or stops only at the state it names', { timeout: 300000 }, async () => {
  const failures = [];
  const dead = [];
  let requests = 0;
  for (const row of rows) {
    const result = await fuzzRow(app, admin, scanner, row, VALUES);
    requests += result.requests;
    failures.push(...result.failures);
    if (!result.reached) dead.push(`${row[0]} ${typeof row[1] === 'string' ? row[1] : row[3].name} → ${result.baseline} ${result.answer}`);
  }
  assert.ok(requests > 1000, `${requests} requests`);
  assert.deepEqual(dead, []);
  assert.deepEqual([...new Set(failures)], []);
});

test('rule 68 — what the fuzz found behind the baselines: each its own refusal', async () => {
  const { reservation, property } = app.ids;
  const notes = await app.call(admin, 'PUT', `/api/calendar-notes/${property}/${dayAt(5)}`, { note: { a: 1 } });
  assert.equal(notes.status, 400);
  assert.equal(notes.json.field, 'note');
  assert.equal((await app.call(admin, 'PUT', `/api/calendar-notes/${property}/${dayAt(5)}`, { note: null })).status, 200, 'null clears a note');

  const cancel = await app.call(admin, 'POST', `/api/reservations/${reservation}/cancel`, { reason: { a: 1 } });
  assert.equal(cancel.status, 400);
  assert.equal(cancel.json.field, 'reason');

  const before = app.readDb('SELECT reservationNumber FROM reservations WHERE id = ?', reservation)[0].reservationNumber;
  const row = (await app.call(admin, 'GET', `/api/reservations/${reservation}`)).json;
  assert.equal((await app.call(admin, 'PUT', `/api/reservations/${reservation}`, { ...row, reservationNumber: null })).status, 200);
  assert.equal(app.readDb('SELECT reservationNumber FROM reservations WHERE id = ?', reservation)[0].reservationNumber, before, 'null keeps the number, never the word');

  for (const list of [{ dates: [null] }, { amounts: [null] }, { dates: ['x'] }, { amounts: [1] }]) {
    const mark = app.logMark();
    const res = await app.call(admin, 'PUT', `/api/reservations/${reservation}/installments`, list);
    assert.equal(res.status, 400, JSON.stringify(list));
    assert.equal(res.json.error, 'INVALID_PAYLOAD');
    assert.doesNotMatch(app.logSince(mark), /\[unhandled\]/);
  }

  const url = `/api/properties/${property}/ical-sources`;
  await app.call(admin, 'POST', url, { platformKey: 'abritel', platformLabel: 'Abritel' });
  const other = await app.call(admin, 'POST', url, { platformKey: 'airbnb', platformLabel: 'Airbnb' });
  const taken = await app.call(admin, 'PUT', `${url}/${other.json.id}`, { platformKey: 'abritel' });
  assert.equal(taken.status, 409, taken.text);
  assert.equal(taken.json.code, 'SOURCE_EXISTS');

  const resourceUrl = '/api/resources';
  const resource = { name: 'R', quantity: 1, price: 1, priceType: 'per_stay' };
  for (const body of [{ propertyIds: [1.5] }, { propertyIds: [1e308] }, { propertyIds: [999999] }, { propertyPricing: { 999999: { price: 1 } } }, { propertyPricing: { abc: { price: 1 } } }]) {
    const res = await app.call(admin, 'POST', resourceUrl, { ...resource, ...body });
    assert.equal(res.status, 422, JSON.stringify(body));
  }
});
