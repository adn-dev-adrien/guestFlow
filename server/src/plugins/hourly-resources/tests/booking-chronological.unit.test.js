// specs/resource-supplements-total-server-side.md rule 23, reading of 2026-11-05 (audit R24-P3) — a booking ends after it
// starts, on the preview, the create and the update, whatever the resource's minimum duration; a stored pair of times sent
// back is exempt. A reversed or empty slot used to be stored at 0 €.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { startApp } = require('../../../tests/inputShapeApp');

const MESSAGE = 'L’heure de fin doit suivre l’heure de début.';
const dayAt = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
let app;
let admin;
let resourceId;

test.before(async () => {
  app = await startApp();
  admin = await app.login('admin@shape.test');
  const active = await app.activatePlugins(admin, ['hourly-resources']);
  assert.ok(active.has('hourly-resources'));
  const made = await app.call(admin, 'POST', '/api/resources', { name: 'Bain', quantity: 5, price: 10, priceType: 'per_hour', minimumUsageMinutes: 0 });
  assert.equal(made.status, 200, made.text);
  resourceId = made.json.id;
});
test.after(async () => { if (app) await app.stop(); });

const count = () => app.readDb('SELECT COUNT(*) AS n FROM resource_bookings')[0].n;
const booking = (over = {}) => ({ resourceId, date: dayAt(20), startTime: '10:00', endTime: '11:00', clientName: 'Marie', ...over });

test('rule 23 — an end at or before the start is refused on preview and create, nothing stored', async () => {
  const before = count();
  for (const [startTime, endTime] of [['12:00', '10:00'], ['12:00', '12:00'], ['23:00', '00:00']]) {
    const created = await app.call(admin, 'POST', '/api/resource-bookings', booking({ startTime, endTime }));
    assert.equal(created.status, 400, `${startTime}→${endTime}: ${created.text}`);
    assert.equal(created.json.error, MESSAGE);
    const preview = await app.call(admin, 'POST', '/api/resource-bookings/preview', { resourceId, date: dayAt(20), startTime, endTime, propertyId: '' });
    assert.equal(preview.status, 400, `preview ${startTime}→${endTime}: ${preview.text}`);
    assert.equal(preview.json.error, MESSAGE);
  }
  assert.equal(count(), before);
  const ok = await app.call(admin, 'POST', '/api/resource-bookings', booking({ startTime: '10:00', endTime: '10:30' }));
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.totalPrice, 5);
});

test('rule 23 — the update refuses a reversed slot, keeps the row and its price', async () => {
  const made = await app.call(admin, 'POST', '/api/resource-bookings', booking({ date: dayAt(21), startTime: '20:00', endTime: '20:30' }));
  assert.equal(made.status, 200, made.text);
  const id = made.json.id;
  for (const body of [{ startTime: '23:00', endTime: '20:00' }, { endTime: '19:00' }, { startTime: '20:30' }]) {
    const res = await app.call(admin, 'PUT', `/api/resource-bookings/${id}`, body);
    assert.equal(res.status, 400, `${JSON.stringify(body)}: ${res.text}`);
    assert.equal(res.json.error, MESSAGE);
  }
  assert.deepEqual(app.readDb('SELECT startTime, endTime, totalPrice FROM resource_bookings WHERE id = ?', id)[0], { startTime: '20:00', endTime: '20:30', totalPrice: 5 });
});

test('rule 23 — a stored reversed pair sent back is exempt, a new pair is judged', async () => {
  const made = await app.call(admin, 'POST', '/api/resource-bookings', booking({ date: dayAt(22) }));
  const id = made.json.id;
  const db = new Database(app.dbPath);
  try { db.prepare("UPDATE resource_bookings SET startTime = '12:00', endTime = '10:00' WHERE id = ?").run(id); } finally { db.close(); }
  const notes = await app.call(admin, 'PUT', `/api/resource-bookings/${id}`, { notes: 'kept', startTime: '12:00', endTime: '10:00' });
  assert.equal(notes.status, 200, notes.text);
  const absent = await app.call(admin, 'PUT', `/api/resource-bookings/${id}`, { notes: 'again' });
  assert.equal(absent.status, 200, absent.text);
  const edited = await app.call(admin, 'POST', '/api/resource-bookings/preview', { resourceId, bookingId: id, date: dayAt(22), startTime: '12:00', endTime: '10:00', propertyId: '' });
  assert.equal(edited.status, 200, edited.text);
  const moved = await app.call(admin, 'PUT', `/api/resource-bookings/${id}`, { startTime: '13:00', endTime: '10:00' });
  assert.equal(moved.status, 400, moved.text);
  assert.equal(moved.json.error, MESSAGE);
  const fixed = await app.call(admin, 'PUT', `/api/resource-bookings/${id}`, { startTime: '10:00', endTime: '12:00' });
  assert.equal(fixed.status, 200, fixed.text);
});
