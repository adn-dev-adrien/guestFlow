// specs/reception-sas-lock-after-commit.md — the « Accueil » role runs the SAS that is still pending
// and can NEVER re-edit one already committed (the re-edit power of specs/reopen-completed-sas.md
// stays admin-only). The guard is state-based (it reads `arrivalSasDoneAt` / `departureSasDoneAt`),
// so it lives in the controller, not in the path allowlist of enforceRoleAccess.
//
// These tests call commitArrival / commitDeparture directly and assert BOTH the HTTP answer and the
// absence of any model write on a refusal.

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

// `reservation` = what getByIdWithDetails returns (only the SAS done markers matter here).
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
    // constants/roles is deliberately NOT mocked → the real isReceptionOnly runs, so this test
    // guards the actual role predicate wiring.
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

function commit(mode, { user, reservation }) {
  const captures = { writes: [] };
  const controller = buildController({ captures, reservation });
  const res = fakeRes();
  const req = { params: { id: '1' }, body: {}, user };
  if (mode === 'arrival') controller.commitArrival(req, res);
  else controller.commitDeparture(req, res);
  return { res, captures };
}

// ---- rule 1: reception is refused on an already-committed SAS, before any write ----

test('commitArrival — reception-only + arrivalSasDoneAt set → 403 SAS_ALREADY_COMMITTED, no write', () => {
  const { res, captures } = commit('arrival', {
    user: RECEPTION_USER,
    reservation: { id: 1, arrivalSasDoneAt: '2026-08-04 15:12:00', departureSasDoneAt: null },
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'SAS_ALREADY_COMMITTED' });
  assert.deepEqual(captures.writes, []);
});

test('commitDeparture — reception-only + departureSasDoneAt set → 403 SAS_ALREADY_COMMITTED, no write', () => {
  const { res, captures } = commit('departure', {
    user: RECEPTION_USER,
    reservation: { id: 1, arrivalSasDoneAt: null, departureSasDoneAt: '2026-08-04 10:30:00' },
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'SAS_ALREADY_COMMITTED' });
  assert.deepEqual(captures.writes, []);
});

// ---- rules 1 & 5: a pending SAS stays fully committable by reception ----

test('commitArrival — reception-only on a pending SAS → 200 + the commit runs', () => {
  const { res, captures } = commit('arrival', {
    user: RECEPTION_USER,
    reservation: { id: 1, arrivalSasDoneAt: null, departureSasDoneAt: null },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.ok(captures.writes.some((w) => w.fn === 'commitArrivalSas'));
});

test('commitDeparture — reception-only on a pending SAS → 200 + the commit runs', () => {
  const { res, captures } = commit('departure', {
    user: RECEPTION_USER,
    reservation: { id: 1, arrivalSasDoneAt: null, departureSasDoneAt: null },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.ok(captures.writes.some((w) => w.fn === 'commitDepartureSas'));
});

// ---- rule 6: the two SAS are independent ----

test('commitDeparture — reception-only with only the ARRIVAL done → 200 (the arrival lock does not spill)', () => {
  const { res, captures } = commit('departure', {
    user: RECEPTION_USER,
    reservation: { id: 1, arrivalSasDoneAt: '2026-08-04 15:12:00', departureSasDoneAt: null },
  });
  assert.equal(res.statusCode, 200);
  assert.ok(captures.writes.some((w) => w.fn === 'commitDepartureSas'));
});

test('commitArrival — reception-only with only the DEPARTURE done → 200 (the departure lock does not spill)', () => {
  const { res, captures } = commit('arrival', {
    user: RECEPTION_USER,
    reservation: { id: 1, arrivalSasDoneAt: null, departureSasDoneAt: '2026-08-04 10:30:00' },
  });
  assert.equal(res.statusCode, 200);
  assert.ok(captures.writes.some((w) => w.fn === 'commitArrivalSas'));
});

// ---- rule 2: admin keeps the full re-edit (specs/reopen-completed-sas.md) ----

test('commitArrival — admin on a committed SAS → 200, the re-edit still works', () => {
  const { res, captures } = commit('arrival', {
    user: ADMIN_USER,
    reservation: { id: 1, arrivalSasDoneAt: '2026-08-04 15:12:00', departureSasDoneAt: null },
  });
  assert.equal(res.statusCode, 200);
  assert.ok(captures.writes.some((w) => w.fn === 'commitArrivalSas'));
});

test('commitDeparture — reception + admin on a committed SAS → 200 (admin wins)', () => {
  const { res, captures } = commit('departure', {
    user: BOTH_USER,
    reservation: { id: 1, arrivalSasDoneAt: null, departureSasDoneAt: '2026-08-04 10:30:00' },
  });
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
