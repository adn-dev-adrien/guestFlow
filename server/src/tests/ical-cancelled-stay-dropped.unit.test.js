// specs/ical-cancellation-approval.md rule 13 (audit 2026-10-27) — a stay already cancelled in GuestFlow
// (`kind` ≠ 'reservation') that its feed later drops raises no cancellation alert; an alert raised before
// the fix is closed without deleting the row. Approving it used to hard-delete the cancelled stay, and
// the delete cascaded its refunds — the credit note owed to the guest was lost.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const { globalFetch } = require('./icalFetchFixture');
const model = require('../models/propertyIcalModel').buildModel(require('../database'), { fetchImpl: globalFetch });
const reservationsModel = require('../models/reservationsModel');
const cancellationModel = require('../models/icalCancellationModel');

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

async function cancelledStayWithRefund() {
  const propertyId = Number(db.prepare("INSERT INTO properties (name, defaultCheckIn, defaultCheckOut) VALUES ('Gîte', '16:00', '10:00')").run().lastInsertRowid);
  const sourceId = db.prepare("INSERT INTO ical_sources (propertyId, name, url, platformKey, platformLabel, isActive) VALUES (?, 'Monsite', 'http://x.test/f.ics', 'monsite', 'Monsite', 1)").run(propertyId).lastInsertRowid;
  const source = db.prepare('SELECT * FROM ical_sources WHERE id = ?').get(sourceId);
  feed([{ uid: 'M1', start: '20271105', end: '20271110', summary: 'Jean Dupont' }]);
  await model.syncSourceAndRecord(source);
  const id = db.prepare('SELECT id FROM reservations WHERE propertyId = ?').get(propertyId).id;
  reservationsModel.markCancelled(id, { reason: 'test' });
  db.prepare("INSERT INTO reservation_refunds (reservationId, refundDate, totalTtc, reason) VALUES (?, '2026-10-27', 120, 'avoir')").run(id);
  return { id, source };
}

test('a stay cancelled in GuestFlow that leaves its feed raises no cancellation alert', async () => {
  const { id, source } = await cancelledStayWithRefund();
  feed([{ uid: 'OTHER', start: '20271201', end: '20271203', summary: 'Paul Durand' }]);
  const r = await model.syncSourceAndRecord(source);
  assert.equal(r.removedCount, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_cancellation_alerts WHERE reservationId = ?').get(id).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_import_events WHERE reservationId = ?').get(id).c, 0, 'its mapping is dropped');
  assert.equal(db.prepare('SELECT kind FROM reservations WHERE id = ?').get(id).kind, 'cancelled');
});

test('approving an alert left on a cancelled stay keeps the row and its credit note', async () => {
  const { id, source } = await cancelledStayWithRefund();
  // An alert raised before the fix.
  const alert = cancellationModel.recordPending({ reservationId: id, sourceId: source.id, eventUid: 'M1' });
  const result = cancellationModel.approve(alert.id);
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'already_cancelled');
  assert.equal(result.reservationId, null, 'no second « reservation.cancelled » event');
  assert.equal(db.prepare('SELECT kind FROM reservations WHERE id = ?').get(id).kind, 'cancelled');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservation_refunds WHERE reservationId = ?').get(id).c, 1);
  assert.equal(db.prepare('SELECT outcome FROM ical_cancellation_alerts WHERE id = ?').get(alert.id).outcome, 'already_cancelled');
  assert.equal(cancellationModel.listPending().some((p) => p.id === alert.id), false);
});

test('a live stay leaving its feed still goes to the cancellation approval', async () => {
  const propertyId = Number(db.prepare("INSERT INTO properties (name) VALUES ('Tente')").run().lastInsertRowid);
  const sourceId = db.prepare("INSERT INTO ical_sources (propertyId, name, url, platformKey, platformLabel, isActive) VALUES (?, 'Greengo', 'http://y.test/f.ics', 'greengo', 'Greengo', 1)").run(propertyId).lastInsertRowid;
  const source = db.prepare('SELECT * FROM ical_sources WHERE id = ?').get(sourceId);
  feed([{ uid: 'G1', start: '20271105', end: '20271110', summary: 'Jean Dupont' }]);
  await model.syncSourceAndRecord(source);
  feed([{ uid: 'G2', start: '20271201', end: '20271203', summary: 'Paul Durand' }]);
  const r = await model.syncSourceAndRecord(source);
  assert.equal(r.removedCount, 1);
});
