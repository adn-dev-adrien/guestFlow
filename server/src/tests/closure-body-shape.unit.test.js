// specs/establishment-closures.md rule 22 (audit R23-2) — a malformed propertyId used to close every property; only null, '' and
// 'null' mean « all ». Through the real application, on the routes the fiche's dialog calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./inputShapeApp');

const T = JSON.parse('{"toString":1}');
const dayAt = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
let app;
let admin;
let offset = 200;
const range = () => { offset += 5; return { startDate: dayAt(offset), endDate: dayAt(offset + 2) }; };
const count = () => app.readDb('SELECT COUNT(*) AS n FROM establishment_closures')[0].n;

test.before(async () => {
  app = await startApp();
  admin = await app.login('admin@shape.test');
});
test.after(async () => { if (app) await app.stop(); });

test('rule 22 — a propertyId that names no property is INVALID_PROPERTY, never « all properties »', async () => {
  const before = count();
  for (const propertyId of ['abc', -1, 0, 1.5, {}, T, true, [app.ids.property], 999999, '999999']) {
    const res = await app.call(admin, 'POST', '/api/establishment-closures', { ...range(), propertyId });
    assert.equal(res.status, 400, JSON.stringify(propertyId));
    assert.equal(res.json.code, 'INVALID_PROPERTY', JSON.stringify(propertyId));
  }
  assert.equal(count(), before);
});

test('rule 22 — null, empty and « null » still mean every property; an id or its digits one', async () => {
  for (const propertyId of [null, '', 'null', undefined]) {
    const res = await app.call(admin, 'POST', '/api/establishment-closures', { ...range(), propertyId });
    assert.equal(res.status, 200, res.text);
    assert.equal(app.readDb('SELECT propertyId FROM establishment_closures WHERE id = ?', res.json.id)[0].propertyId, null);
  }
  for (const propertyId of [app.ids.property, String(app.ids.property)]) {
    const res = await app.call(admin, 'POST', '/api/establishment-closures', { ...range(), propertyId });
    assert.equal(res.status, 200, res.text);
    assert.equal(app.readDb('SELECT propertyId FROM establishment_closures WHERE id = ?', res.json.id)[0].propertyId, app.ids.property);
  }
});

test('rule 22 — a label is a string or absent, on create and update', async () => {
  const created = await app.call(admin, 'POST', '/api/establishment-closures', { ...range(), propertyId: null, label: 'Travaux' });
  for (const label of [{}, T, true, [1, 2], 5]) {
    const res = await app.call(admin, 'POST', '/api/establishment-closures', { ...range(), propertyId: null, label });
    assert.equal(res.status, 400, JSON.stringify(label));
    assert.equal(res.json.code, 'INVALID_LABEL');
    const put = await app.call(admin, 'PUT', `/api/establishment-closures/${created.json.id}`, { ...range(), propertyId: null, label });
    assert.equal(put.status, 400, JSON.stringify(label));
  }
  assert.deepEqual(app.readDb("SELECT label FROM establishment_closures WHERE label LIKE '%bject%' OR label = 'True'"), []);
  const absent = await app.call(admin, 'POST', '/api/establishment-closures', { ...range(), propertyId: null });
  assert.equal(app.readDb('SELECT label FROM establishment_closures WHERE id = ?', absent.json.id)[0].label, 'Fermeture établissement');
});

test('rule 22 — DELETE of an unknown id is a 404, of a real one a 200', async () => {
  const created = await app.call(admin, 'POST', '/api/establishment-closures', { ...range(), propertyId: null });
  assert.equal((await app.call(admin, 'DELETE', '/api/establishment-closures/999999')).status, 404);
  assert.equal((await app.call(admin, 'DELETE', '/api/establishment-closures/abc')).status, 404);
  assert.equal((await app.call(admin, 'DELETE', `/api/establishment-closures/${created.json.id}`)).status, 200);
});
