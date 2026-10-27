// specs/ical-summary-fallback-cross-uid.md rule 7 and specs/ical-import-hardening.md rule 15 (audit
// 2026-10-27) — a summary that names nobody (Airbnb « Reserved », Gîtes de France « BOOKED ») is shared by
// every stay of a feed, so neither the same-summary re-claim (step 3.5) nor the cross-source de-dup may
// match on it: the first handed a cancelled stay's fiche to an unrelated new booking, the second merged
// two platforms' stays sold on the same dates into one.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const model = require('../models/propertyIcalModel');
const icalModel = require('../models/icalModel');

function ics(events) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTART;VALUE=DATE:${e.start}`, `DTEND;VALUE=DATE:${e.end}`, `SUMMARY:${e.summary}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
const feed = (events) => { global.fetch = async () => ({ ok: true, status: 200, text: async () => ics(events) }); };
const origFetch = global.fetch;
test.afterEach(() => { global.fetch = origFetch; });

function property() {
  return Number(db.prepare("INSERT INTO properties (name, defaultCheckIn, defaultCheckOut) VALUES ('Gîte', '16:00', '10:00')").run().lastInsertRowid);
}
function source(propertyId, key, label) {
  const id = db.prepare("INSERT INTO ical_sources (propertyId, name, url, platformKey, platformLabel, isActive) VALUES (?, ?, 'http://x.test/f.ics', ?, ?, 1)")
    .run(propertyId, label, key, label).lastInsertRowid;
  return db.prepare('SELECT * FROM ical_sources WHERE id = ?').get(id);
}
const stays = (propertyId) => db.prepare('SELECT id, startDate, endDate, platform, bookingConflictAt FROM reservations WHERE propertyId = ? ORDER BY id').all(propertyId);
const pendingCancellations = (reservationId) => db.prepare('SELECT COUNT(*) c FROM ical_cancellation_alerts WHERE reservationId = ? AND acknowledgedAt IS NULL').get(reservationId).c;

for (const [key, label, summary] of [['airbnb', 'Airbnb', 'Reserved'], ['gites-de-france', 'GitesDeFrance', 'BOOKED']]) {
  test(`${label} « ${summary} » — a cancelled stay never hands its fiche to a new one arriving in the same sync`, async () => {
    const propertyId = property();
    const src = source(propertyId, key, label);
    feed([{ uid: 'A', start: '20270705', end: '20270710', summary }, { uid: 'C', start: '20270801', end: '20270803', summary }]);
    await model.syncSourceAndRecord(src);
    const idA = stays(propertyId).find((s) => s.startDate === '2027-07-05').id;

    feed([{ uid: 'B', start: '20270720', end: '20270725', summary }, { uid: 'C', start: '20270801', end: '20270803', summary }]);
    const r = await model.syncSourceAndRecord(src);
    assert.equal(r.createdCount, 1, 'B is a new stay');
    assert.equal(r.updatedCount, 0);
    const a = db.prepare('SELECT startDate, endDate FROM reservations WHERE id = ?').get(idA);
    assert.deepEqual(a, { startDate: '2027-07-05', endDate: '2027-07-10' }, 'A keeps its own dates');
    assert.equal(pendingCancellations(idA), 1, 'A goes to the cancellation approval');
  });
}

test('a locked nameless stay: the new booking is created and exported, no misleading drift alert', async () => {
  const propertyId = property();
  const src = source(propertyId, 'airbnb', 'Airbnb');
  feed([{ uid: 'A', start: '20270705', end: '20270710', summary: 'Reserved' }]);
  await model.syncSourceAndRecord(src);
  db.prepare('UPDATE reservations SET icalSyncLocked = 1 WHERE propertyId = ?').run(propertyId);

  feed([{ uid: 'B', start: '20270720', end: '20270725', summary: 'Reserved' }]);
  const r = await model.syncSourceAndRecord(src);
  assert.equal(r.createdCount, 1);
  assert.equal(r.lockedCount, 0);
  assert.equal(stays(propertyId).length, 2);
  const ids = stays(propertyId).map((s) => s.id);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM ical_date_drift_alerts WHERE reservationId IN (${ids.join(',')})`).get().c, 0);
  assert.match(icalModel.exportProperty(propertyId), /DTSTART[^\r\n]*:20270720/, 'B blocks its nights for the other channels');
});

test('a summary naming a guest still re-claims a stay moved under a new UID (step 3.5 unchanged)', async () => {
  const propertyId = property();
  const src = source(propertyId, 'abracadaroom', 'Abracadaroom');
  feed([{ uid: 'X1', start: '20270705', end: '20270710', summary: 'Jean Dupont' }]);
  await model.syncSourceAndRecord(src);
  const [before] = stays(propertyId);
  feed([{ uid: 'X2', start: '20270712', end: '20270717', summary: 'Jean Dupont' }]);
  const r = await model.syncSourceAndRecord(src);
  assert.equal(r.createdCount, 0);
  assert.equal(r.updatedCount, 1);
  assert.deepEqual(stays(propertyId).map((s) => [s.id, s.startDate]), [[before.id, '2027-07-12']]);
});

test('two platforms\' nameless stays on the same dates are two stays, flagged in conflict', async () => {
  const propertyId = property();
  const airbnb = source(propertyId, 'airbnb', 'Airbnb');
  const abritel = source(propertyId, 'abritel', 'Abritel');
  feed([{ uid: 'airbnb-HM1', start: '20270705', end: '20270710', summary: 'Reserved' }]);
  await model.syncSourceAndRecord(airbnb);
  feed([{ uid: 'abritel-HA9', start: '20270705', end: '20270710', summary: 'Reserved' }]);
  const r = await model.syncSourceAndRecord(abritel);
  assert.equal(r.createdCount, 1);
  const rows = stays(propertyId);
  assert.equal(rows.length, 2);
  const abritelStay = rows.find((s) => s.platform === 'Abritel');
  assert.ok(abritelStay.bookingConflictAt, 'the overbooking is visible');
  assert.deepEqual(r.conflictReservationIds, [abritelStay.id]);
});

test('the same guest named on two platforms on the same dates is still one stay (cross-source de-dup unchanged)', async () => {
  const propertyId = property();
  const lodgify = source(propertyId, 'lodgify', 'Lodgify');
  const greengo = source(propertyId, 'greengo', 'Greengo');
  feed([{ uid: 'L1', start: '20270705', end: '20270710', summary: 'Marie Martin' }]);
  await model.syncSourceAndRecord(lodgify);
  feed([{ uid: 'G1', start: '20270705', end: '20270710', summary: 'Marie Martin' }]);
  const r = await model.syncSourceAndRecord(greengo);
  assert.equal(r.createdCount, 0);
  assert.equal(stays(propertyId).length, 1);
});
