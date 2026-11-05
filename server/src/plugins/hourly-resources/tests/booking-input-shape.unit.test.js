// specs/resource-supplements-total-server-side.md rule 23 (audit R23-A2) — a resource booking from a valid baseline, one field
// wrong at a time: the refusal of that field, never a 500 and never a stored bad value. The dialog's own payloads pass.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../../../tests/inputShapeApp');

const T = JSON.parse('{"toString":1}');
const WRONG_ID = [T, {}, [], true, 1.5, -1, 1e308, [1, 2], 'x'];
const WRONG_TIME = [T, {}, [], ['x'], true, 1.5, -1, 1e308, '99:99', 'xx', '1:5'];
const WRONG_TEXT = [T, {}, [], ['x'], true, 1.5, -1, 1e308];
const dayAt = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
let app;
let admin;
let resourceId;
let bookingId;
let slot = 0;

const free = () => { slot += 1; return dayAt(40 + slot); };
const baseline = (over = {}) => ({ resourceId, date: free(), startTime: '10:00', endTime: '11:00', propertyId: String(app.ids.property), notes: '', paid: false, clientId: app.ids.client, clientName: null, clientPhone: null, displayedTotal: 30, ...over });
const count = () => app.readDb('SELECT COUNT(*) AS n FROM resource_bookings')[0].n;

test.before(async () => {
  app = await startApp();
  admin = await app.login('admin@shape.test');
  const active = await app.activatePlugins(admin, ['hourly-resources']);
  assert.ok(active.has('hourly-resources'));
  const made = await app.call(admin, 'POST', '/api/resources', { name: 'Bain', quantity: 5, price: 30, priceType: 'per_hour', minimumUsageMinutes: 60 });
  resourceId = made.json.id;
  bookingId = (await app.call(admin, 'POST', '/api/resource-bookings', baseline())).json.id;
});
test.after(async () => { if (app) await app.stop(); });

async function refused(method, url, body, label) {
  const mark = app.logMark();
  const res = await app.call(admin, method, url, body);
  assert.ok(res.status >= 400 && res.status < 500, `${label} → ${res.status} ${res.text.slice(0, 200)}`);
  assert.doesNotMatch(app.logSince(mark), /\[unhandled\]/, label);
  return res;
}

test('rule 23 — the dialog\'s payloads pass, external client and known client', async () => {
  const known = await app.call(admin, 'POST', '/api/resource-bookings', baseline());
  assert.equal(known.status, 200, known.text);
  const external = await app.call(admin, 'POST', '/api/resource-bookings', baseline({ clientId: null, clientName: 'Marie', clientPhone: '0600000000', propertyId: null, paid: true, displayedTotal: undefined }));
  assert.equal(external.status, 200, external.text);
  const preview = await app.call(admin, 'POST', '/api/resource-bookings/preview', { resourceId, bookingId: undefined, date: free(), startTime: '10:00', endTime: '11:00', propertyId: '' });
  assert.equal(preview.status, 200, preview.text);
  const edit = await app.call(admin, 'POST', '/api/resource-bookings/preview', { resourceId, bookingId, date: free(), startTime: '10:00', endTime: '11:00', propertyId: String(app.ids.property) });
  assert.equal(edit.status, 200, edit.text);
  const update = await app.call(admin, 'PUT', `/api/resource-bookings/${bookingId}`, baseline());
  assert.equal(update.status, 200, update.text);
});

test('rule 23 — create: each wrong field is refused, nothing stored', async () => {
  const before = count();
  for (const field of ['resourceId', 'reservationId', 'clientId', 'propertyId']) {
    for (const value of WRONG_ID) await refused('POST', '/api/resource-bookings', baseline({ [field]: value }), `${field} ${JSON.stringify(value)}`);
  }
  for (const field of ['startTime', 'endTime']) {
    for (const value of WRONG_TIME) await refused('POST', '/api/resource-bookings', baseline({ [field]: value }), `${field} ${JSON.stringify(value)}`);
  }
  for (const field of ['clientName', 'clientPhone', 'notes']) {
    for (const value of WRONG_TEXT) await refused('POST', '/api/resource-bookings', baseline({ [field]: value }), `${field} ${JSON.stringify(value)}`);
  }
  for (const value of [T, {}, [], 'x', 'true', 2, 1.5]) await refused('POST', '/api/resource-bookings', baseline({ paid: value }), `paid ${JSON.stringify(value)}`);
  for (const value of [T, {}, [], true, 'x']) await refused('POST', '/api/resource-bookings', baseline({ displayedTotal: value }), `displayedTotal ${JSON.stringify(value)}`);
  for (const value of [T, {}, [], true, 1.5, 'x']) await refused('POST', '/api/resource-bookings', baseline({ date: value }), `date ${JSON.stringify(value)}`);
  assert.equal(count(), before);
});

test('rule 23 — an id well typed but unknown is 404, not a foreign key', async () => {
  for (const field of ['resourceId', 'reservationId', 'clientId', 'propertyId']) {
    const res = await refused('POST', '/api/resource-bookings', baseline({ [field]: 999999 }), field);
    assert.equal(res.status, 404, `${field} ${res.text}`);
  }
  const res = await refused('POST', '/api/resource-bookings/preview', { resourceId, bookingId: 999999, date: free(), startTime: '10:00', endTime: '11:00' }, 'bookingId');
  assert.equal(res.status, 404);
});

test('rule 23 — preview and update judge the same fields', async () => {
  for (const field of ['resourceId', 'bookingId', 'propertyId']) {
    for (const value of WRONG_ID) await refused('POST', '/api/resource-bookings/preview', { resourceId, date: free(), startTime: '10:00', endTime: '11:00', [field]: value }, `preview ${field} ${JSON.stringify(value)}`);
  }
  for (const field of ['startTime', 'endTime']) {
    for (const value of WRONG_TIME) {
      await refused('POST', '/api/resource-bookings/preview', { resourceId, date: free(), startTime: '10:00', endTime: '11:00', [field]: value }, `preview ${field} ${JSON.stringify(value)}`);
      await refused('PUT', `/api/resource-bookings/${bookingId}`, { [field]: value }, `update ${field} ${JSON.stringify(value)}`);
    }
    await refused('PUT', `/api/resource-bookings/${bookingId}`, { [field]: null }, `update ${field} null`);
  }
  for (const field of ['notes', 'clientName', 'clientPhone']) {
    for (const value of WRONG_TEXT) await refused('PUT', `/api/resource-bookings/${bookingId}`, { [field]: value }, `update ${field} ${JSON.stringify(value)}`);
  }
  for (const value of [T, {}, 'x', 2]) await refused('PUT', `/api/resource-bookings/${bookingId}`, { paid: value }, `update paid ${JSON.stringify(value)}`);
  assert.deepEqual(app.readDb("SELECT id FROM resource_bookings WHERE startTime NOT GLOB '[0-2][0-9]:[0-5][0-9]' OR endTime NOT GLOB '[0-2][0-9]:[0-5][0-9]'"), []);
});

test('rule 23 — a stored time and a stored id sent back unchanged are not re-judged', async () => {
  const Database = require('better-sqlite3');
  const raw = new Database(app.dbPath);
  raw.prepare("UPDATE resource_bookings SET startTime = '7:30', endTime = '24:00' WHERE id = ?").run(bookingId);
  raw.close();
  const res = await app.call(admin, 'PUT', `/api/resource-bookings/${bookingId}`, { startTime: '7:30', endTime: '24:00', notes: 'gardé' });
  assert.ok(res.status === 200 || res.status === 409, res.text);
  assert.notEqual(res.status, 400);
});
