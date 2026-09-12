const test = require('node:test');
const assert = require('node:assert/strict');

const {
  makeGateDb, insertStay, makeModel, fakeRes, fakeReq, loadGuestController,
} = require('./gateFixtures');
const gateSession = require('../utils/gateSession');

// specs/guest-gate-access.md §3.3 (getting in) and §3.8 rule 27 (one session, one access).

process.env.GUEST_BASE_URL = 'https://guest.test';
process.env.GATE_SESSION_SECRET = 'test-secret-for-the-guest-cookie';

function setup({ startIso = '2026-09-12T17:00:00.000Z', stay = {} } = {}) {
  const db = makeGateDb();
  db.exec("CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT)");
  db.exec("CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT)");
  db.prepare('INSERT INTO clients (id, firstName, lastName) VALUES (1, ?, ?)').run('Camille', 'Roux');
  db.prepare('INSERT INTO properties (id, name) VALUES (1, ?)').run('Le Gîte');
  db.prepare('INSERT INTO properties (id, name) VALUES (2, ?)').run('La Lodge');
  db.exec('ALTER TABLE reservations ADD COLUMN reservationNumber TEXT');

  const stayId = insertStay(db, stay);
  db.prepare('UPDATE reservations SET reservationNumber = ? WHERE id = ?').run('202609042', stayId);

  const { model, clock } = makeModel(db, startIso);
  const access = model.ensureForReservation(stayId);
  const { controller, queue } = loadGuestController({ db, model });
  return { db, model, clock, access, controller, queue, stayId };
}

// --- the code ---

test('a code that matches nothing answers a flat 401', () => {
  const { controller } = setup();
  const res = fakeRes();
  controller.openSession(fakeReq({ body: { code: 'ZZZZ-ZZZZ' } }), res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: { code: 'INVALID_CODE' } });
  assert.equal(res.cookie(), null, 'no session for a stranger');
});

test('the refusal is recorded even though no access matched', () => {
  const { db, controller } = setup();
  controller.openSession(fakeReq({ body: { code: 'ZZZZ-ZZZZ' } }), fakeRes());

  const row = db.prepare("SELECT * FROM gate_events WHERE kind = 'code_ko' ORDER BY id DESC").get();
  assert.ok(row, 'a failed attempt must leave a trace');
  assert.equal(row.accessId, null);
  assert.equal(row.reason, 'unknown');
  assert.equal(row.ip, '203.0.113.7');
});

test('the right code opens a session and hands the page everything it renders', () => {
  const { access, controller } = setup();
  const res = fakeRes();
  controller.openSession(fakeReq({ body: { code: access.code } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.state, 'active');
  assert.equal(res.body.stay.guestLabel, 'Camille');
  assert.equal(res.body.stay.propertyName, 'Le Gîte');
  assert.equal(res.body.stay.reservationNumber, '202609042');
  assert.equal(res.body.stay.endsAtLabel, '14/09 11:00');
  assert.equal(res.body.service.phone, '06.15.73.93.37');
  assert.equal(res.body.gate.state, 'unknown', 'nothing has been heard from the house yet');
  assert.equal(res.body.service.available, false);
  assert.match(res.cookie(), /^gate_sid=/, 'plain name over http — the __Host- prefix needs Secure');
});

test('the dashed, lower-cased form the guest actually types is accepted', () => {
  const { access, controller } = setup();
  const dashed = `${access.code.slice(0, 4)}-${access.code.slice(4)}`.toLowerCase();
  const res = fakeRes();
  controller.openSession(fakeReq({ body: { code: ` ${dashed} ` } }), res);
  assert.equal(res.statusCode, 200);
});

test('the share link carries the code — that is what the family gets', () => {
  const { access, controller } = setup();
  const res = fakeRes();
  controller.openSession(fakeReq({ body: { code: access.code } }), res);

  assert.equal(res.body.share.url, `https://guest.test/?c=${access.code}`);
  assert.equal(res.body.share.code, `${access.code.slice(0, 4)}-${access.code.slice(4)}`);
});

test('a locked code is indistinguishable from a wrong one', () => {
  const { model, access, controller } = setup();
  for (let i = 0; i < 10; i += 1) model.noteCodeFailure(access.id);

  const res = fakeRes();
  controller.openSession(fakeReq({ body: { code: access.code } }), res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: { code: 'INVALID_CODE' } });
  assert.equal(res.cookie(), null);
});

test('a successful entry wipes the failure count', () => {
  const { model, access, controller } = setup();
  for (let i = 0; i < 3; i += 1) model.noteCodeFailure(access.id);

  controller.openSession(fakeReq({ body: { code: access.code } }), fakeRes());
  assert.equal(model.resolve(access.id).access.failedCount, 0);
});

// --- the window, seen from the page ---

test('before the stay: 403 NOT_YET_ACTIVE, but the payload still says when', () => {
  const { access, controller } = setup({ startIso: '2026-09-12T09:00:00.000Z' }); // 11:00 Paris
  const res = fakeRes();
  controller.openSession(fakeReq({ body: { code: access.code } }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'NOT_YET_ACTIVE');
  assert.equal(res.body.stay.startsAt, '2026-09-12T14:00:00.000Z', 'the page needs this to count down');
  assert.equal(res.body.stay.guestLabel, 'Camille');
  assert.ok(res.cookie(), 'and a session, so a reload does not ask for the code again');
});

test('after the stay: 403 EXPIRED, with the farewell the page shows', () => {
  const { access, controller } = setup({ startIso: '2026-09-14T12:00:00.000Z' }); // 14:00 Paris, three hours late
  const res = fakeRes();
  controller.openSession(fakeReq({ body: { code: access.code } }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'EXPIRED');
  assert.equal(res.body.stay.reservationNumber, '202609042');
});

// --- the session cookie ---

test('GET /session without a cookie, or with a forged one, is 401', () => {
  const { controller } = setup();

  const bare = fakeRes();
  controller.readSessionState(fakeReq({}), bare);
  assert.equal(bare.statusCode, 401);
  assert.equal(bare.body.error.code, 'NO_SESSION');

  const forged = fakeRes();
  controller.readSessionState(fakeReq({ cookie: 'gate_sid=1.deadbeef.notasignature' }), forged);
  assert.equal(forged.statusCode, 401, 'a tampered signature buys nothing');
});

test('GET /session with the cookie returns the same payload as the unlock', () => {
  const { access, controller } = setup();
  const opened = fakeRes();
  controller.openSession(fakeReq({ body: { code: access.code } }), opened);

  const res = fakeRes();
  controller.readSessionState(fakeReq({ cookie: opened.cookie() }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.stay.propertyName, 'Le Gîte');
});

test('a revoked access answers 403 REVOKED to a cookie that was valid a second ago', () => {
  const { model, access, controller } = setup();
  const opened = fakeRes();
  controller.openSession(fakeReq({ body: { code: access.code } }), opened);
  const cookie = opened.cookie();

  model.revoke(access.id);

  const res = fakeRes();
  controller.readSessionState(fakeReq({ cookie }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'REVOKED');
});

// --- one phone, two stays (§3.8 rule 27) ---

test('the same phone keeps its device id across two unlocks of the same access', () => {
  const { model, access, controller } = setup();
  const first = fakeRes();
  controller.openSession(fakeReq({ body: { code: access.code } }), first);
  const second = fakeRes();
  controller.openSession(fakeReq({ body: { code: access.code }, cookie: first.cookie() }), second);

  assert.equal(first.cookie(), second.cookie(), 'same device, same cookie');
  assert.equal(model.countDevices(access.id), 1, 'and one device, not two');
});

test('the family that stayed at the gîte last year and books the lodge gets a clean session', () => {
  const { db, model, controller } = setup();
  const giteAccess = model.ensureForReservation(1);

  const lodgeStay = insertStay(db, { propertyId: 2, startDate: '2026-09-10', endDate: '2026-09-17' });
  const lodgeAccess = model.ensureForReservation(lodgeStay);

  const gite = fakeRes();
  controller.openSession(fakeReq({ body: { code: giteAccess.code } }), gite);

  // Same browser, still carrying the gîte cookie, now typing the lodge code.
  const lodge = fakeRes();
  controller.openSession(fakeReq({ body: { code: lodgeAccess.code }, cookie: gite.cookie() }), lodge);

  assert.equal(lodge.statusCode, 200);
  assert.equal(lodge.body.stay.propertyName, 'La Lodge');
  const parsed = gateSession.parse(lodge.cookie().split('=')[1], process.env.GATE_SESSION_SECRET);
  assert.equal(parsed.accessId, lodgeAccess.id, 'the session moved to the new access');
  assert.notEqual(lodge.cookie(), gite.cookie());
  assert.equal(model.countDevices(lodgeAccess.id), 1);

  // And the old cookie still reads its own stay, which is live too — both lodgings at once.
  const back = fakeRes();
  controller.readSessionState(fakeReq({ cookie: gite.cookie() }), back);
  assert.equal(back.body.stay.propertyName, 'Le Gîte');
});

test('every device is remembered, none is refused', () => {
  const { model, access, controller } = setup();
  for (let i = 0; i < 8; i += 1) {
    const res = fakeRes();
    controller.openSession(fakeReq({ body: { code: access.code } }), res);
    assert.equal(res.statusCode, 200, `phone ${i + 1} must get in`);
  }
  assert.equal(model.countDevices(access.id), 8, 'a cap would lock the brother-in-law out at 23 h');
});
