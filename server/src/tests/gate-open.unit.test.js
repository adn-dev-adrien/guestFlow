const test = require('node:test');
const assert = require('node:assert/strict');

const {
  makeGateDb, insertStay, makeModel, fakeRes, fakeReq, loadGuestController,
} = require('./gateFixtures');

// specs/guest-gate-access.md §3.5 (opening) and §3.8 rule 28 (the guard that protects a car).

process.env.GUEST_BASE_URL = 'https://guest.test';
process.env.GATE_SESSION_SECRET = 'test-secret-for-the-guest-cookie';

function setup({ startIso = '2026-09-12T17:00:00.000Z' } = {}) {
  const db = makeGateDb();
  db.exec("CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT)");
  db.exec("CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT)");
  db.exec('ALTER TABLE reservations ADD COLUMN reservationNumber TEXT');
  db.prepare('INSERT INTO clients (id, firstName, lastName) VALUES (1, ?, ?)').run('Camille', 'Roux');
  db.prepare('INSERT INTO properties (id, name) VALUES (1, ?)').run('Le Gîte');
  db.prepare('INSERT INTO properties (id, name) VALUES (2, ?)').run('La Lodge');

  const stayId = insertStay(db);
  const { model, clock } = makeModel(db, startIso);
  const access = model.ensureForReservation(stayId);
  const { controller, queue } = loadGuestController({ db, model });

  const unlock = fakeRes();
  controller.openSession(fakeReq({ body: { code: access.code } }), unlock);

  return { db, model, clock, access, controller, queue, cookie: unlock.cookie(), stayId };
}

function press(controller, cookie) {
  const res = fakeRes();
  controller.requestOpen(fakeReq({ cookie }), res);
  return res;
}

test('no session, no gate', () => {
  const { controller } = setup();
  const res = press(controller, null);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error.code, 'NO_SESSION');
});

test('with the house silent, the press is refused 503 — the button was already greyed out', () => {
  const { controller, cookie, queue } = setup();
  const res = press(controller, cookie);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
  assert.equal(queue.notified, 0, 'nobody is woken for a request that was never created');
});

test('the happy path: one request, and a poller woken', () => {
  const { model, controller, cookie, queue, db } = setup();
  model.noteHeartbeat({ state: 'closed' });

  const res = press(controller, cookie);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'pending');
  assert.ok(res.body.requestId);
  assert.equal(res.body.deduped, false);
  assert.equal(queue.notified, 1);

  const journal = db.prepare("SELECT * FROM gate_events WHERE kind = 'open' ORDER BY id DESC").get();
  assert.ok(journal, 'the press is in the journal');
  assert.ok(journal.deviceId, 'and it says which phone');
});

test('the gate already open: the command goes out anyway, and the button says « Fermer »', () => {
  // Decision 2026-09-10 — the reversal. A guest who wants to close the gate behind them presses
  // the same button; the state is information, never a veto. The earlier version of this test
  // asserted the opposite, and the behaviour it pinned took away something guests legitimately do.
  const { model, controller, cookie, queue, db } = setup();
  model.noteHeartbeat({ state: 'open' });

  const res = press(controller, cookie);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'pending', 'a real request, not a polite refusal');
  assert.ok(res.body.requestId);
  assert.equal(queue.notified, 1, 'the house is woken');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gate_requests').get().n, 1);

  // And the page labels the button by what the pulse will do.
  const session = fakeRes();
  controller.readSessionState(fakeReq({ cookie }), session);
  assert.equal(session.body.gate.state, 'open');
});

test('two presses in a row are one request, and wake one poller', () => {
  const { model, controller, cookie, queue } = setup();
  model.noteHeartbeat({ state: 'closed' });

  const first = press(controller, cookie);
  const second = press(controller, cookie);

  assert.equal(second.body.requestId, first.body.requestId);
  assert.equal(second.body.deduped, true);
  assert.equal(queue.notified, 1, 'the duplicate must not wake anyone a second time');
});

test('the two lodgings both press while the gate is shut: two requests, two wake-ups', () => {
  const { db, model, controller, queue, cookie: giteCookie } = setup();
  model.noteHeartbeat({ state: 'closed' });

  const lodgeStay = insertStay(db, { propertyId: 2, startDate: '2026-09-10', endDate: '2026-09-17' });
  const lodgeAccess = model.ensureForReservation(lodgeStay);
  const lodgeUnlock = fakeRes();
  controller.openSession(fakeReq({ body: { code: lodgeAccess.code } }), lodgeUnlock);

  const gite = press(controller, giteCookie);
  const lodge = press(controller, lodgeUnlock.cookie());

  assert.equal(gite.statusCode, 200);
  assert.equal(lodge.statusCode, 200);
  assert.equal(lodge.body.deduped, false, 'the other lodging is not a duplicate');
  assert.notEqual(lodge.body.requestId, gite.body.requestId);
  assert.equal(queue.notified, 2);

  // The house serves them one at a time, in order — the gîte pressed first.
  assert.equal(model.claimNextRequest().id, gite.body.requestId);
  assert.equal(model.claimNextRequest().id, lodge.body.requestId);
});

test('the second lodging pressing during the travel gets its own pulse', () => {
  // Two people, two remotes: the second press may well close the gate again. Named and accepted
  // (spec §3.8 rule 28) — and the journal says who pressed when.
  const { db, model, controller, queue, cookie: giteCookie } = setup();
  model.noteHeartbeat({ state: 'closed' });

  const lodgeStay = insertStay(db, { propertyId: 2, startDate: '2026-09-10', endDate: '2026-09-17' });
  const lodgeAccess = model.ensureForReservation(lodgeStay);
  const lodgeUnlock = fakeRes();
  controller.openSession(fakeReq({ body: { code: lodgeAccess.code } }), lodgeUnlock);

  const gite = press(controller, giteCookie);
  model.resolveRequest(gite.body.requestId, 'opened');
  model.noteHeartbeat({ state: 'open' });      // the gate has left the closed position

  const lodge = press(controller, lodgeUnlock.cookie());
  assert.equal(lodge.body.status, 'pending');
  assert.ok(lodge.body.requestId);
  assert.notEqual(lodge.body.requestId, gite.body.requestId);
  assert.equal(queue.notified, 2, 'two intents, two pulses');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gate_requests').get().n, 2);
});

test('outside the window, the press is refused with the reason the page shows', () => {
  const { model, controller, cookie, clock } = setup();
  model.noteHeartbeat({ state: 'closed' });

  clock.set('2026-09-14T12:00:00.000Z'); // two hours after the grace
  model.noteHeartbeat({ state: 'closed' });
  const res = press(controller, cookie);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'EXPIRED');
});

test('a revoked access cannot press, whatever cookie the phone still holds', () => {
  const { model, controller, cookie, access } = setup();
  model.noteHeartbeat({ state: 'closed' });
  model.revoke(access.id);

  const res = press(controller, cookie);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'REVOKED');
});

test('the per-access ceiling stops the twelfth press of the hour', () => {
  const { model, controller, cookie, clock } = setup();

  for (let i = 0; i < model.OPENS_PER_HOUR_PER_ACCESS; i += 1) {
    model.noteHeartbeat({ state: 'closed' });
    const res = press(controller, cookie);
    assert.equal(res.statusCode, 200, `press ${i + 1} must go through`);
    model.resolveRequest(res.body.requestId, 'opened');
    clock.advance(11 * 1000);
  }

  model.noteHeartbeat({ state: 'closed' });
  const refused = press(controller, cookie);
  assert.equal(refused.statusCode, 429);
  assert.equal(refused.body.error.code, 'TOO_MANY_OPENS');

  clock.advance(61 * 60 * 1000);
  model.noteHeartbeat({ state: 'closed' });
  assert.equal(press(controller, cookie).statusCode, 200, 'an hour later the guest is not a suspect');
});

// --- the status the page polls while the gate travels ---

test('the status walks from pending to the answer the house gave', () => {
  const { model, controller, cookie } = setup();
  model.noteHeartbeat({ state: 'closed' });
  const { body } = press(controller, cookie);

  const pending = fakeRes();
  controller.readRequestStatus(fakeReq({ cookie, params: { requestId: body.requestId } }), pending);
  assert.equal(pending.body.status, 'pending');

  model.resolveRequest(body.requestId, 'opened');
  const opened = fakeRes();
  controller.readRequestStatus(fakeReq({ cookie, params: { requestId: body.requestId } }), opened);
  assert.equal(opened.body.status, 'opened');
});

test('a refusal from the house comes back with its reason', () => {
  const { model, controller, cookie } = setup();
  model.noteHeartbeat({ state: 'closed' });
  const { body } = press(controller, cookie);

  model.resolveRequest(body.requestId, 'refused', { detail: 'guest access disarmed' });
  const res = fakeRes();
  controller.readRequestStatus(fakeReq({ cookie, params: { requestId: body.requestId } }), res);

  assert.equal(res.body.status, 'refused');
  assert.equal(res.body.detail, 'guest access disarmed');
});

test('a request nobody answered reads timeout once the read notices', () => {
  const { model, controller, cookie, clock } = setup();
  model.noteHeartbeat({ state: 'closed' });
  const { body } = press(controller, cookie);

  clock.advance(31 * 1000);
  const res = fakeRes();
  controller.readRequestStatus(fakeReq({ cookie, params: { requestId: body.requestId } }), res);
  assert.equal(res.body.status, 'timeout');
});

test('another lodging\'s request is not found — this session has no business knowing it exists', () => {
  const { db, model, controller, cookie } = setup();
  model.noteHeartbeat({ state: 'closed' });

  const lodgeStay = insertStay(db, { propertyId: 2, startDate: '2026-09-10', endDate: '2026-09-17' });
  const lodgeAccess = model.ensureForReservation(lodgeStay);
  const { request } = model.createRequest({ accessId: lodgeAccess.id });

  const res = fakeRes();
  controller.readRequestStatus(fakeReq({ cookie, params: { requestId: request.id } }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});
