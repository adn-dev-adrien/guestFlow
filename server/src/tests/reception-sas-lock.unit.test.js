// specs/reception-sas-today-only.md §3.2 rule 5 — the « Accueil » role only commits the SAS of the DAY
// that has never been committed: a past, future or already-committed SAS is refused. The rule depends
// on the reservation's dates + markers, so it lives in the controller, not in the path allowlist of
// enforceRoleAccess.
//
// These tests call commitArrival / commitDeparture directly and assert BOTH the HTTP answer and the
// absence of any model write on a refusal. Dates are built from the real clock (the controller reads
// `new Date()`), with a 2-day margin so a run at 02:00 — still inside yesterday's 04:00 tail — can't
// flip a « past » case.

const test = require('node:test');
const assert = require('node:assert/strict');

const { isReceptionOnly } = require('../constants/roles');

const Module = require('module');

function withMocks(modules, fn) {
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return origRequire.call(this, id);
  };
  try { return fn(); } finally { Module.prototype.require = origRequire; }
}

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function isoDay(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const TODAY = isoDay(0);
const PAST = isoDay(-2);
const FUTURE = isoDay(2);

function buildController({ captures, reservation }) {
  const reservationsModelMock = new Proxy({}, { get: (_, k) => {
    if (k === 'getByIdWithDetails') return () => reservation;
    if (k === 'getRow') return () => ({ ...reservation, endOfStayComplementDetail: '[]' });
    if (k === 'getSasUpsellOptions') return () => ({ cleaning: { present: false }, bathLinen: { present: false } });
    if (k === 'listSasArrivalCustomLines') return () => [];
    if (k === 'commitArrivalSas') return (...args) => { captures.writes.push({ fn: 'commitArrivalSas', args }); return 0; };
    if (k === 'commitDepartureSas') return (...args) => { captures.writes.push({ fn: 'commitDepartureSas', args }); };
    if (k === 'addHistoryEntry') return (...args) => { captures.writes.push({ fn: 'addHistoryEntry', args }); };
    return () => null;
  } });

  const controllerModule = '../controllers/sasController';
  return withMocks({
    // constants/roles + utils/sasEditWindow are deliberately NOT mocked → the real predicate and the
    // real window arithmetic run, so this test guards the actual wiring.
    '../models/reservationsModel': reservationsModelMock,
    '../models/linenItemsModel': { list: () => [] },
    '../models/settingsModel': { read: () => ({}) },
    '../models/breakfastModel': { getForReservation: () => ({ applicable: false }) },
    '../models/repairAmountsModel': { list: () => [] },
    '../utils/sasAudit': { buildSasSnapshot: () => ({}), computeSasChanges: () => [] },
  }, () => {
    delete require.cache[require.resolve(controllerModule)];
    return require(controllerModule);
  });
}

const RECEPTION_USER = { id: 2, roles: ['reception'] };
const ADMIN_USER = { id: 1, roles: ['admin'] };
const BOTH_USER = { id: 3, roles: ['reception', 'admin'] };

// A stay whose arrival and departure dates are set independently, so each SAS can be tested alone.
function stay({ start = TODAY, end = TODAY, arrivalDoneAt = null, departureDoneAt = null } = {}) {
  return { id: 1, startDate: start, endDate: end, arrivalSasDoneAt: arrivalDoneAt, departureSasDoneAt: departureDoneAt };
}

function commit(mode, { user, reservation }) {
  const captures = { writes: [] };
  const controller = buildController({ captures, reservation });
  const res = fakeRes();
  const req = { params: { id: '1' }, body: {}, user };
  if (mode === 'arrival') controller.commitArrival(req, res);
  else controller.commitDeparture(req, res);
  return { res, captures };
}

// ---- rule 5: reception is refused outside the window, before any write ----

test('commitArrival — reception + already committed → 403 SAS_LOCKED/done, no write', () => {
  const { res, captures } = commit('arrival', {
    user: RECEPTION_USER,
    reservation: stay({ arrivalDoneAt: `${TODAY} 15:12:00` }),
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'SAS_LOCKED', reason: 'done' });
  assert.deepEqual(captures.writes, []);
});

test('commitArrival — reception + arrival in the past → 403 SAS_LOCKED/past, no write', () => {
  const { res, captures } = commit('arrival', { user: RECEPTION_USER, reservation: stay({ start: PAST }) });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'SAS_LOCKED', reason: 'past' });
  assert.deepEqual(captures.writes, []);
});

test('commitArrival — reception + arrival in the future → 403 SAS_LOCKED/future, no write', () => {
  const { res, captures } = commit('arrival', { user: RECEPTION_USER, reservation: stay({ start: FUTURE }) });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'SAS_LOCKED', reason: 'future' });
  assert.deepEqual(captures.writes, []);
});

test('commitDeparture — reception + departure in the past / future / done → 403, no write', () => {
  for (const [reservation, reason] of [
    [stay({ end: PAST }), 'past'],
    [stay({ end: FUTURE }), 'future'],
    [stay({ departureDoneAt: `${TODAY} 10:30:00` }), 'done'],
  ]) {
    const { res, captures } = commit('departure', { user: RECEPTION_USER, reservation });
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: 'SAS_LOCKED', reason });
    assert.deepEqual(captures.writes, []);
  }
});

// ---- rule 5 (happy path): today's pending SAS stays fully committable ----

test("commitArrival — reception on today's pending arrival → 200 + the commit runs", () => {
  const { res, captures } = commit('arrival', { user: RECEPTION_USER, reservation: stay() });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.ok(captures.writes.some((w) => w.fn === 'commitArrivalSas'));
});

test("commitDeparture — reception on today's pending departure → 200 + the commit runs", () => {
  const { res, captures } = commit('departure', { user: RECEPTION_USER, reservation: stay() });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.ok(captures.writes.some((w) => w.fn === 'commitDepartureSas'));
});

// ---- rule 4: the two SAS are independent ----

test('a locked arrival never locks the departure (and vice versa)', () => {
  // Arrived 2 days ago (arrival past + done), departs today → the departure SAS is still open.
  const leaving = commit('departure', {
    user: RECEPTION_USER,
    reservation: stay({ start: PAST, end: TODAY, arrivalDoneAt: `${PAST} 16:00:00` }),
  });
  assert.equal(leaving.res.statusCode, 200);
  assert.ok(leaving.captures.writes.some((w) => w.fn === 'commitDepartureSas'));

  // Arrives today, leaves in 2 days → the arrival SAS is open even though the departure is future.
  const arriving = commit('arrival', { user: RECEPTION_USER, reservation: stay({ start: TODAY, end: FUTURE }) });
  assert.equal(arriving.res.statusCode, 200);
  assert.ok(arriving.captures.writes.some((w) => w.fn === 'commitArrivalSas'));
});

// ---- rule 7: admin keeps the full re-edit, any date ----

test('commitArrival — admin on a past, committed SAS → 200, the re-edit still works', () => {
  const { res, captures } = commit('arrival', {
    user: ADMIN_USER,
    reservation: stay({ start: PAST, arrivalDoneAt: `${PAST} 15:12:00` }),
  });
  assert.equal(res.statusCode, 200);
  assert.ok(captures.writes.some((w) => w.fn === 'commitArrivalSas'));
});

test('commitDeparture — reception + admin on a future SAS → 200 (admin wins)', () => {
  const { res, captures } = commit('departure', { user: BOTH_USER, reservation: stay({ end: FUTURE }) });
  assert.equal(res.statusCode, 200);
  assert.ok(captures.writes.some((w) => w.fn === 'commitDepartureSas'));
});

// ---- the shared predicate itself (server source of truth, mirrored client-side) ----

test('isReceptionOnly — truth table', () => {
  assert.equal(isReceptionOnly({ roles: ['reception'] }), true);
  assert.equal(isReceptionOnly({ roles: ['reception', 'accountant'] }), true);
  assert.equal(isReceptionOnly({ roles: ['reception', 'admin'] }), false);
  assert.equal(isReceptionOnly({ roles: ['admin'] }), false);
  assert.equal(isReceptionOnly({ roles: ['accountant'] }), false);
  assert.equal(isReceptionOnly({ roles: [] }), false);
  assert.equal(isReceptionOnly(null), false);
  // Legacy single-role session shape (pre-multi-role) still resolves.
  assert.equal(isReceptionOnly({ role: 'reception' }), true);
  assert.equal(isReceptionOnly({ role: 'admin' }), false);
});
