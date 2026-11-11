// specs/reservations-backend-mvc.md rule 23 (audit R23-8) — on an update, a blank time is « not sent » (rule 20) and
// keeps what the stay stores, as the devis does; a stay storing none takes its property's. The model's 15:00 / 10:00
// fallback moved the arrival an hour earlier, past the cleaning check, which read the blank as no change.
const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay } = require('./datesTakenFixture');
const controller = require('../controllers/reservationsController');

const FROM = inDays(60);
const TO = inDays(64);

async function put(id, times) {
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await controller.update({
    params: { id: String(id) },
    query: {},
    user: { roles: ['admin'] },
    body: {
      propertyId: row.propertyId, clientId: 1, startDate: row.startDate, endDate: row.endDate, platform: 'direct',
      adults: 2, children: 0, teens: 0, babies: 0, babyBeds: 0, customPrice: 300, depositAmount: 90, balanceAmount: 210,
      forceMinNights: true, forceMaxNights: true, forceChangeover: true, forceCapacity: true,
      ...times,
    },
  }, res);
  return res;
}

const times = (id) => db.prepare('SELECT checkInTime, checkOutTime, blocksPreviousNight FROM reservations WHERE id = ?').get(id);

for (const [name, blank] of [['empty', { checkInTime: '', checkOutTime: '' }], ['null', { checkInTime: null, checkOutTime: null }], ['absent', {}]]) {
  test(`rule 23 — ${name} times keep the stored ones`, async () => {
    const id = addStay({ propertyId: freshProperty(), start: FROM, end: TO, checkInTime: '17:00', checkOutTime: '09:00' });
    const res = await put(id, blank);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepEqual(times(id), { checkInTime: '17:00', checkOutTime: '09:00', blocksPreviousNight: 0 });
  });
}

test('rule 23 — a stay storing no time takes the property default, never 15:00 / 10:00', async () => {
  const propertyId = freshProperty();
  db.prepare("UPDATE properties SET defaultCheckOut = '11:00' WHERE id = ?").run(propertyId);
  const id = addStay({ propertyId, start: FROM, end: TO });
  db.prepare('UPDATE reservations SET checkInTime = NULL, checkOutTime = NULL WHERE id = ?').run(id);
  const res = await put(id, { checkInTime: '', checkOutTime: '' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(times(id).checkInTime, '16:00');
  assert.equal(times(id).checkOutTime, '11:00');
});

test('rule 23 — one blank time keeps its own, the other is written', async () => {
  const id = addStay({ propertyId: freshProperty(), start: FROM, end: TO, checkInTime: '17:00', checkOutTime: '09:00' });
  const res = await put(id, { checkInTime: '', checkOutTime: '09:30' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(times(id), { checkInTime: '17:00', checkOutTime: '09:30', blocksPreviousNight: 0 });
});

test('rule 23 — a blank time cannot slip past the cleaning check: the stored arrival stands', async () => {
  const propertyId = freshProperty();
  db.prepare('UPDATE properties SET cleaningHours = 3 WHERE id = ?').run(propertyId);
  addStay({ propertyId, start: inDays(57), end: FROM, checkOutTime: '12:00' });
  const id = addStay({ propertyId, start: FROM, end: TO, checkInTime: '16:00', checkOutTime: '10:00' });
  const res = await put(id, { checkInTime: '', checkOutTime: '' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(times(id).checkInTime, '16:00');
});

test('rule 23 — a time really sent still moves, and is still judged', async () => {
  const propertyId = freshProperty();
  db.prepare('UPDATE properties SET cleaningHours = 3 WHERE id = ?').run(propertyId);
  addStay({ propertyId, start: inDays(57), end: FROM, checkOutTime: '12:00' });
  const id = addStay({ propertyId, start: FROM, end: TO, checkInTime: '16:00', checkOutTime: '10:00' });
  const refused = await put(id, { checkInTime: '14:00', checkOutTime: '10:00' });
  assert.equal(refused.statusCode, 409, JSON.stringify(refused.body));
  assert.equal(times(id).checkInTime, '16:00');
});
