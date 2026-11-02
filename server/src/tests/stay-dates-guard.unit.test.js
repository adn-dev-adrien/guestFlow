// specs/reservations-backend-mvc.md rule 11 (audit R18-1, 2026-11-02) — every internal write and quote of a stay
// refuses dates that are not `YYYY-MM-DD` real days, or a departure that does not follow the arrival: 400
// INVALID_STAY_DATES with a short French message, before pricing and availability, nothing written. A reversed
// stay used to be created at 0 €, free its nights for a double booking, and reach the iCal export.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');
const devisController = require('../controllers/devisController');
const dashboardController = require('../controllers/dashboardController');
const icalDateDriftModel = require('../models/icalDateDriftModel');
const { isRealIsoDay, stayDatesRefusal } = require('../utils/stayDates');
const { parseIcsEvents } = require('../utils/icalParser');

const ORDER = "La date de départ doit suivre la date d'arrivée.";
const INVALID = 'Date de séjour invalide.';

// The four shapes the audit created on the shadow, all hung on today: reversed, zero nights, a day the
// calendar does not have, a date that is not zero-padded.
const nextYear = Number(f.inDays(200).slice(0, 4)) + 1;
const SHAPES = [
  { name: 'reversed', startDate: f.inDays(200), endDate: f.inDays(198), message: ORDER, field: 'endDate' },
  { name: 'zero nights', startDate: f.inDays(200), endDate: f.inDays(200), message: ORDER, field: 'endDate' },
  { name: 'no such day', startDate: `${nextYear}-02-30`, endDate: `${nextYear}-03-02`, message: INVALID, field: 'startDate' },
  { name: 'not ISO', startDate: `${nextYear}-2-3`, endDate: `${nextYear}-02-05`, message: INVALID, field: 'startDate' },
];

const count = (kind) => f.db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE kind = ?').get(kind).n;

function call(handler, req) {
  const res = f.respond();
  const out = handler(req, res);
  return out && typeof out.then === 'function' ? out.then(() => res) : res;
}

function assertRefused(res, shape) {
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.code, 'INVALID_STAY_DATES');
  assert.equal(res.body.error, shape.message);
  assert.equal(res.body.field, shape.field, 'every endpoint names the date at fault');
}

test('rule 11: the pure guard', () => {
  // date-literal-ok: inputs of a pure function, never compared with today.
  assert.equal(isRealIsoDay('2028-02-29'), true);
  assert.equal(isRealIsoDay('2027-02-29'), false); // date-literal-ok: not a leap year
  assert.equal(isRealIsoDay('2027-13-01'), false); // date-literal-ok: no month 13
  assert.equal(isRealIsoDay(' 2027-01-01'), false); // date-literal-ok: padded
  assert.equal(isRealIsoDay(20270101), false);
  assert.equal(isRealIsoDay(null), false);
  assert.equal(stayDatesRefusal(f.inDays(10), f.inDays(11)), null);
  assert.deepEqual(stayDatesRefusal(f.inDays(10), f.inDays(9)), { status: 400, error: ORDER, code: 'INVALID_STAY_DATES', field: 'endDate' });
  assert.equal(stayDatesRefusal('', f.inDays(9)).field, 'startDate');
});

SHAPES.forEach((shape, i) => {
  const at = (n) => f.inDays(n + i * 30);
  test(`rule 11: POST /reservations refuses a ${shape.name} stay and writes nothing`, () => {
    const before = count('reservation');
    const res = f.create(f.stayBody({ startDate: shape.startDate, endDate: shape.endDate }));
    assertRefused(res, shape);
    assert.equal(count('reservation'), before);
  });

  test(`rule 11: PUT /reservations/:id refuses a ${shape.name} stay and keeps the stored dates`, async () => {
    const id = f.createStay({ startDate: at(400), endDate: at(403) });
    const res = await f.save(id, { startDate: shape.startDate, endDate: shape.endDate });
    assertRefused(res, shape);
    const row = f.rowOf(id);
    assert.equal(row.startDate, at(400));
    assert.equal(row.endDate, at(403));
    assert.ok(Number(row.finalPrice) > 0);
  });

  test(`rule 11: a server caller of performUpdate (a plugin) gets the same refusal for a ${shape.name} stay`, () => {
    const id = f.createStay({ startDate: at(410), endDate: at(412) });
    const out = f.controller.performUpdate(id, f.ficheBody(id, { startDate: shape.startDate, endDate: shape.endDate }));
    assert.equal(out.status, 400);
    assert.equal(out.body.code, 'INVALID_STAY_DATES');
    assert.equal(f.rowOf(id).endDate, at(412));
  });

  test(`rule 11: calculate-price refuses a ${shape.name} stay instead of quoting 0 €`, async () => {
    const res = await call(f.controller.calculatePrice, { body: f.stayBody({ startDate: shape.startDate, endDate: shape.endDate }), user: f.ADMIN });
    assertRefused(res, shape);
  });

  test(`rule 11: POST /devis refuses a ${shape.name} stay and writes nothing`, () => {
    f.seed();
    const before = count('devis');
    const res = call(devisController.create, { body: f.stayBody({ startDate: shape.startDate, endDate: shape.endDate }), user: f.ADMIN });
    assertRefused(res, shape);
    assert.equal(count('devis'), before);
  });

  test(`rule 11: PUT /devis/:id refuses a ${shape.name} stay and keeps the stored dates`, () => {
    f.seed();
    const created = call(devisController.create, { body: f.stayBody({ startDate: at(420), endDate: at(423) }), user: f.ADMIN });
    assert.equal(created.statusCode, 201, JSON.stringify(created.body));
    const id = created.body.id;
    const res = call(devisController.update, { params: { id: String(id) }, body: f.stayBody({ startDate: shape.startDate, endDate: shape.endDate }), user: f.ADMIN });
    assertRefused(res, shape);
    assert.equal(f.rowOf(id).startDate, at(420));
  });
});

test('rule 11: a valid stay still saves (one night)', async () => {
  const id = f.createStay({ startDate: f.inDays(330), endDate: f.inDays(331) });
  const res = await f.save(id, { endDate: f.inDays(332) });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(f.rowOf(id).endDate, f.inDays(332));
});

// Rows written before the guard: the paths that act on STORED dates refuse them too, rather than extend,
// convert or restore a stay that blocks nothing.
function storeDates(id, startDate, endDate) {
  f.db.prepare('UPDATE reservations SET startDate = ?, endDate = ? WHERE id = ?').run(startDate, endDate, id);
}

test('rule 11: extending or converting a devis whose stored dates are reversed is refused', () => {
  f.seed();
  const created = call(devisController.create, { body: f.stayBody({ startDate: f.inDays(340), endDate: f.inDays(342) }), user: f.ADMIN });
  const id = created.body.id;
  storeDates(id, f.inDays(342), f.inDays(340));
  f.db.prepare("UPDATE reservations SET devisStatus = 'sent', validUntil = ? WHERE id = ?").run(f.inDays(-1), id);
  for (const handler of [devisController.extend, devisController.extensionPreview, devisController.convertToReservation]) {
    const res = call(handler, { params: { id: String(id) }, user: f.ADMIN });
    assert.equal(res.statusCode, 400, `${handler.name}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.code, 'INVALID_STAY_DATES');
    assert.equal(res.body.field, 'endDate', handler.name);
  }
  assert.equal(f.db.prepare('SELECT convertedReservationId FROM reservations WHERE id = ?').get(id).convertedReservationId, null);
});

test('rule 11: restoring a duplicate set aside whose stored dates are reversed is refused', () => {
  const id = f.createStay({ startDate: f.inDays(350), endDate: f.inDays(352) });
  storeDates(id, f.inDays(352), f.inDays(350));
  f.db.prepare("UPDATE reservations SET kind = 'superseded' WHERE id = ?").run(id);
  const res = call(f.controller.restoreSuperseded, { params: { id: String(id) }, user: f.ADMIN });
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.code, 'INVALID_STAY_DATES');
  assert.equal(res.body.field, 'endDate');
  assert.equal(f.rowOf(id).kind, 'superseded');
});

test('rule 11: approving an iCal date drift onto reversed dates is refused and leaves the stay as it was', () => {
  const id = f.createStay({ startDate: f.inDays(360), endDate: f.inDays(363) });
  const { id: driftId } = icalDateDriftModel.recordPending({
    reservationId: id, previousStartDate: f.inDays(360), previousEndDate: f.inDays(363), newStartDate: f.inDays(365), newEndDate: f.inDays(364),
  });
  const res = call(dashboardController.approveIcalDateDrift, { params: { id: String(driftId) }, user: f.ADMIN });
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.code, 'INVALID_STAY_DATES');
  assert.equal(res.body.field, 'endDate');
  assert.equal(f.rowOf(id).startDate, f.inDays(360));
  assert.equal(f.db.prepare('SELECT acknowledgedAt FROM ical_date_drift_alerts WHERE id = ?').get(driftId).acknowledgedAt, null);
});

// The import never needed the guard (specs/ical-import-hardening.md rule 17): a day the calendar lacks drops the
// event, a reversed or zero-night event becomes one night. Whatever a feed carries, what reaches the sync passes it.
test('rule 11: every event the iCal parser hands to the sync passes the guard', () => {
  const compact = (iso) => iso.replace(/-/g, '');
  const ev = (uid, start, end) => `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART;VALUE=DATE:${start}\r\nDTEND;VALUE=DATE:${end}\r\nSUMMARY:Invité Test\r\nEND:VEVENT`;
  const ics = ['BEGIN:VCALENDAR',
    ev('reversed', compact(f.inDays(40)), compact(f.inDays(38))),
    ev('zero', compact(f.inDays(50)), compact(f.inDays(50))),
    ev('nosuchday', `${nextYear}0230`, `${nextYear}0302`),
    ev('ok', compact(f.inDays(60)), compact(f.inDays(62))),
    'END:VCALENDAR'].join('\r\n');
  const events = parseIcsEvents(ics);
  assert.deepEqual(events.map((e) => e.uid).sort(), ['ok', 'reversed', 'zero']);
  for (const e of events) assert.equal(stayDatesRefusal(e.startDate, e.endDate), null, e.uid);
});
