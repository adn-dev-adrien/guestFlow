// specs/reservations-backend-mvc.md rule 13 (Adrien's decision of 2026-11-02) — no date is entered past today
// + 5 years, the Europe/Paris day: 400 INVALID_STAY_DATES « Date trop lointaine : 5 ans au plus. » on every
// path rule 11 guards; the same message on closures (specs/establishment-closures.md rule 18, reading of
// 2026-11-02) and the finance custom window (specs/finance-dashboard-redesign.md rule 51, reading of
// 2026-11-02). The past is never limited, and a stored date that is not edited is never held to the horizon.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');
const devisController = require('../controllers/devisController');
const dashboardController = require('../controllers/dashboardController');
const icalDateDriftModel = require('../models/icalDateDriftModel');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');
const {
  MAX_HORIZON_YEARS, HORIZON_MESSAGE, horizonEnd, dateBeyondHorizon, stayDatesRefusal,
} = require('../utils/stayDates');
const { validateRange, MESSAGES: CLOSURE_MESSAGES } = require('../utils/establishmentClosuresValidation');
const { resolveWindow, MESSAGES: WINDOW_MESSAGES } = require('../utils/financeWindow');
const closures = require('./closureConflictsFixture');
const finance = require('./financeDashboardFixture');

const H = horizonEnd();
const at = (n) => addDaysToIsoDate(H, n);
const TOO_FAR = { error: HORIZON_MESSAGE, code: 'INVALID_STAY_DATES' };

function call(handler, req) {
  const res = f.respond();
  const out = handler({ user: f.ADMIN, params: {}, query: {}, ...req }, res);
  return out && typeof out.then === 'function' ? out.then(() => res) : res;
}

function assertTooFar(res, field) {
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.deepEqual(res.body, { ...TOO_FAR, field });
}

const storeDates = (id, startDate, endDate) => f.db.prepare('UPDATE reservations SET startDate = ?, endDate = ? WHERE id = ?').run(startDate, endDate, id);

test.before(() => f.seed());

test('rule 13: the horizon is today + 5 years, a 29 February landing on the 28th; the past is free', () => {
  assert.equal(MAX_HORIZON_YEARS, 5);
  assert.equal(HORIZON_MESSAGE, 'Date trop lointaine : 5 ans au plus.');
  const today = todayIso();
  assert.equal(H, `${Number(today.slice(0, 4)) + 5}${today.slice(4)}`.replace(/-02-29$/, '-02-28'));
  const leapYear = Number(today.slice(0, 4)) + (4 - (Number(today.slice(0, 4)) % 4)) % 4;
  assert.equal(horizonEnd(`${leapYear}-02-29`), `${leapYear + 5}-02-28`);
  assert.equal(dateBeyondHorizon(H), false);
  assert.equal(dateBeyondHorizon(at(1)), true);
  assert.equal(dateBeyondHorizon(addDaysToIsoDate(today, -4000)), false);
  assert.equal(stayDatesRefusal(at(-3), H), null);
  assert.deepEqual(stayDatesRefusal(at(-3), at(1)), { status: 400, ...TOO_FAR, field: 'endDate' });
  assert.deepEqual(stayDatesRefusal(at(1), at(3)), { status: 400, ...TOO_FAR, field: 'startDate' });
  assert.equal(stayDatesRefusal(at(1), at(3), { stored: { startDate: at(1), endDate: at(3) } }), null);
  assert.equal(stayDatesRefusal(at(1), at(4), { stored: { startDate: at(1), endDate: at(3) } }).field, 'endDate');
});

test('rule 13: calculate-price quotes up to the horizon and refuses one day past it', async () => {
  const ok = await call(f.controller.calculatePrice, { body: f.stayBody({ startDate: at(-3), endDate: H }) });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assertTooFar(await call(f.controller.calculatePrice, { body: f.stayBody({ startDate: at(-3), endDate: at(1) }) }), 'endDate');
});

test('rule 13: POST /reservations saves a departure on the horizon, refuses one day past it, writes nothing', () => {
  const before = f.db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE kind = 'reservation'").get().n;
  assertTooFar(f.create(f.stayBody({ startDate: at(-2), endDate: at(1) })), 'endDate');
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE kind = 'reservation'").get().n, before);
  const ok = f.create(f.stayBody({ startDate: at(-6), endDate: H }));
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(f.rowOf(ok.body.id).endDate, H);
  f.db.prepare('DELETE FROM reservations WHERE id = ?').run(ok.body.id);
});

test('rule 13: PUT /reservations/:id refuses a date edited past the horizon, keeps the stored one', async () => {
  const id = f.createStay({ startDate: at(-20), endDate: at(-17) });
  assertTooFar(await f.save(id, { startDate: at(-20), endDate: at(1) }), 'endDate');
  assert.equal(f.rowOf(id).endDate, at(-17));
  const ok = await f.save(id, { endDate: H });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
});

test('rule 13: a stay stored past the horizon before the rule still saves and quotes with its dates untouched', async () => {
  const id = f.createStay({ startDate: at(-30), endDate: at(-27) });
  storeDates(id, at(10), at(13));
  const saved = await f.save(id, { notes: 'Arrivée tardive' });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(f.rowOf(id).endDate, at(13));
  const quoted = await call(f.controller.calculatePrice, { body: f.stayBody({ startDate: at(10), endDate: at(13), reservationId: id }) });
  assert.equal(quoted.statusCode, 200, JSON.stringify(quoted.body));
  assertTooFar(await f.save(id, { endDate: at(14) }), 'endDate');
});

test('rule 13: a restore enters no date — a duplicate stored past the horizon is restored', () => {
  const id = f.createStay({ startDate: at(-40), endDate: at(-38) });
  storeDates(id, at(20), at(22));
  f.db.prepare("UPDATE reservations SET kind = 'superseded' WHERE id = ?").run(id);
  const res = call(f.controller.restoreSuperseded, { params: { id: String(id) } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(f.rowOf(id).kind, 'reservation');
});

test('rule 13: an iCal date drift onto the horizon is approved, one day past it is refused and stays pending', () => {
  const id = f.createStay({ startDate: at(-50), endDate: at(-47) });
  const drift = (newStartDate, newEndDate) => icalDateDriftModel.recordPending({
    reservationId: id, previousStartDate: f.rowOf(id).startDate, previousEndDate: f.rowOf(id).endDate, newStartDate, newEndDate,
  }).id;
  const refusedId = drift(at(-3), at(1));
  assertTooFar(call(dashboardController.approveIcalDateDrift, { params: { id: String(refusedId) } }), 'endDate');
  assert.equal(f.rowOf(id).endDate, at(-47));
  assert.equal(f.db.prepare('SELECT acknowledgedAt FROM ical_date_drift_alerts WHERE id = ?').get(refusedId).acknowledgedAt, null);
  call(dashboardController.rejectIcalDateDrift, { params: { id: String(refusedId) } });
  const okId = drift(at(-3), H);
  const ok = call(dashboardController.approveIcalDateDrift, { params: { id: String(okId) } });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(f.rowOf(id).endDate, H);
});

test('rule 13: POST and PUT /devis accept the horizon and refuse one day past it', () => {
  f.seed();
  assertTooFar(call(devisController.create, { body: f.stayBody({ startDate: at(-62), endDate: at(1) }) }), 'endDate');
  const created = call(devisController.create, { body: f.stayBody({ startDate: at(-64), endDate: at(-61) }) });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const id = created.body.id;
  assertTooFar(call(devisController.update, { params: { id: String(id) }, body: f.stayBody({ startDate: at(1), endDate: at(4) }) }), 'startDate');
  assert.equal(f.rowOf(id).startDate, at(-64));
  const moved = call(devisController.update, { params: { id: String(id) }, body: f.stayBody({ startDate: at(-3), endDate: H }) });
  assert.equal(moved.statusCode, 200, JSON.stringify(moved.body));
  assert.equal(f.rowOf(id).endDate, H);
});

test('rule 13: extending, previewing and converting a devis stored past the horizon enter no date and pass', () => {
  f.seed();
  const created = call(devisController.create, { body: f.stayBody({ startDate: at(-80), endDate: at(-78) }) });
  const id = created.body.id;
  storeDates(id, at(30), at(32));
  f.db.prepare("UPDATE reservations SET devisStatus = 'sent', validUntil = ? WHERE id = ?").run(addDaysToIsoDate(todayIso(), -1), id);
  for (const handler of [devisController.extensionPreview, devisController.extend]) {
    const res = call(handler, { params: { id: String(id) } });
    assert.equal(res.statusCode, 200, `${handler.name}: ${JSON.stringify(res.body)}`);
  }
  const converted = call(devisController.convertToReservation, { params: { id: String(id) } });
  assert.ok(converted.statusCode === 200 || converted.statusCode === 201, JSON.stringify(converted.body));
  const reservationId = f.db.prepare('SELECT convertedReservationId FROM reservations WHERE id = ?').get(id).convertedReservationId;
  assert.equal(f.rowOf(reservationId).endDate, at(32));
});

test('rule 18 (reading of 2026-11-02): a closure may end on the horizon, not one day past it', () => {
  assert.equal(CLOSURE_MESSAGES.tooFar, HORIZON_MESSAGE);
  assert.equal(validateRange(at(-10), H), null);
  assert.equal(validateRange(at(-10), at(1)), HORIZON_MESSAGE);
  assert.equal(validateRange(at(1), at(5), { stored: { startDate: at(1), endDate: at(5) } }), null);
  assert.equal(validateRange(addDaysToIsoDate(todayIso(), -700), addDaysToIsoDate(todayIso(), -650)), null);
});

test('rule 18 (reading of 2026-11-02): create, update and the conflicts preview refuse a closure past the horizon', () => {
  const { db, controller } = closures.seedClosures();
  const refused = closures.call(controller.create, { body: { propertyId: 2, startDate: at(-5), endDate: at(1) } });
  assert.equal(refused.statusCode, 400);
  assert.deepEqual(refused.body, { error: HORIZON_MESSAGE, code: 'INVALID_RANGE' });
  const preview = closures.call(controller.conflicts, { query: { propertyId: 2, startDate: at(-5), endDate: at(1) } });
  assert.equal(preview.statusCode, 400);
  assert.equal(preview.body.error, HORIZON_MESSAGE);
  assert.equal(closures.call(controller.conflicts, { query: { propertyId: 2, startDate: at(-5), endDate: H } }).statusCode, 200);

  const ok = closures.call(controller.create, { body: { propertyId: 2, startDate: at(-5), endDate: H } });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  const moved = closures.call(controller.update, { params: { id: ok.body.id }, body: { propertyId: 2, startDate: at(-5), endDate: at(1) } });
  assert.equal(moved.statusCode, 400);
  assert.equal(moved.body.error, HORIZON_MESSAGE);

  // A closure a tariff recipe wrote past the horizon keeps saving while its dates stay as they are.
  const recipe = db.prepare("INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (2, 'Hiver', ?, ?)").run(at(20), at(60)).lastInsertRowid;
  const relabelled = closures.call(controller.update, { params: { id: recipe }, body: { propertyId: 2, label: 'Hiver long', startDate: at(20), endDate: at(60) } });
  assert.equal(relabelled.statusCode, 200, JSON.stringify(relabelled.body));
  const edited = closures.call(controller.update, { params: { id: recipe }, body: { propertyId: 2, startDate: at(20), endDate: at(61) } });
  assert.equal(edited.body.error, HORIZON_MESSAGE);
});

test('rule 51 (reading of 2026-11-02): a custom finance window may end on the horizon, not one day past it', () => {
  const exercise = { key: finance.THIS_YEAR, label: `${finance.THIS_YEAR}`, from: `${finance.THIS_YEAR}-01-01`, to: `${finance.THIS_YEAR}-12-31` };
  assert.equal(WINDOW_MESSAGES.tooFar, HORIZON_MESSAGE);
  assert.equal(resolveWindow({ exercise, kind: 'custom', from: at(-30), to: H, today: todayIso() }).ok, true);
  assert.deepEqual(resolveWindow({ exercise, kind: 'custom', from: at(-30), to: at(1), today: todayIso() }), { ok: false, error: HORIZON_MESSAGE });
  assert.equal(resolveWindow({ exercise, kind: 'custom', from: addDaysToIsoDate(todayIso(), -3000), to: addDaysToIsoDate(todayIso(), -2500), today: todayIso() }).ok, true);
  const { dashboard } = finance.freshDb();
  assert.deepEqual(dashboard.getDashboard({ fiscalYear: finance.THIS_YEAR, period: 'custom', from: at(-30), to: at(1) }), { ok: false, status: 400, error: HORIZON_MESSAGE });
  assert.equal(dashboard.getDashboard({ fiscalYear: finance.THIS_YEAR, period: 'custom', from: at(-30), to: H }).ok, true);
});
