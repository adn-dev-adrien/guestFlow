const test = require('node:test');
const assert = require('node:assert/strict');

const {
  makeGateDb, insertStay, makeModel, fakeRes, fakePollerReq, loadPollerController,
} = require('./gateFixtures');
const requireGateApiKey = require('../middleware/requireGateApiKey');
const gateQueue = require('../utils/gateQueue');

// specs/guest-gate-access.md §4.3 — the two routes the house calls, and the key it comes with.

function setup({ startIso = '2026-09-12T17:00:00.000Z' } = {}) {
  const db = makeGateDb();
  db.exec("CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT)");
  db.exec('ALTER TABLE reservations ADD COLUMN reservationNumber TEXT');
  db.prepare('INSERT INTO properties (id, name) VALUES (1, ?)').run('Le Gîte');

  const stayId = insertStay(db);
  db.prepare('UPDATE reservations SET reservationNumber = ? WHERE id = ?').run('202609042', stayId);
  const { model, clock } = makeModel(db, startIso);
  const access = model.ensureForReservation(stayId);
  const controller = loadPollerController({ db, model });
  return { db, model, clock, access, controller };
}

// --- the key ---

test('with no key configured, every call is refused', () => {
  const previous = process.env.GATE_API_KEY;
  delete process.env.GATE_API_KEY;
  const res = fakeRes();
  requireGateApiKey(fakePollerReq({ key: 'anything' }), res, () => { throw new Error('must not pass'); });
  assert.equal(res.statusCode, 401);
  if (previous !== undefined) process.env.GATE_API_KEY = previous;
});

test('a wrong key is refused, the right one passes, by either header', () => {
  const previous = process.env.GATE_API_KEY;
  process.env.GATE_API_KEY = 'the-house-key';

  const wrong = fakeRes();
  requireGateApiKey(fakePollerReq({ key: 'the-site-key' }), wrong, () => { throw new Error('must not pass'); });
  assert.equal(wrong.statusCode, 401);
  assert.deepEqual(wrong.body, { error: { code: 'UNAUTHORIZED' } });

  let passed = 0;
  requireGateApiKey(fakePollerReq({ key: 'the-house-key' }), fakeRes(), () => { passed += 1; });

  const viaXApiKey = { headers: { 'x-api-key': 'the-house-key' }, get(n) { return this.headers[n.toLowerCase()]; } };
  requireGateApiKey(viaXApiKey, fakeRes(), () => { passed += 1; });
  assert.equal(passed, 2);

  if (previous === undefined) delete process.env.GATE_API_KEY;
  else process.env.GATE_API_KEY = previous;
});

// --- the long poll ---

test('a waiting request is served at once, claimed, and named for the recipe', async () => {
  const { model, access, controller } = setup();
  const { request } = model.createRequest({ accessId: access.id, deviceId: 'phone-a' });

  const res = fakeRes();
  await controller.pollRequests(fakePollerReq({ query: { wait: '0', state: 'closed' } }), res);

  assert.equal(res.body.request.id, request.id);
  assert.equal(res.body.request.propertyName, 'Le Gîte');
  assert.equal(res.body.request.reservationNumber, '202609042');
  assert.ok(model.getRequest(request.id).claimedAt, 'claimed, so a second poller cannot take it');
  assert.equal(res.body.request.deviceId, undefined, 'the house has no business knowing the phone');
});

test('nothing to do is answered quietly, not as an error', async () => {
  const { controller } = setup();
  const res = fakeRes();
  await controller.pollRequests(fakePollerReq({ query: { wait: '0.05', state: 'closed' } }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { request: null });
});

test('every poll is the heartbeat AND the state feed', async () => {
  const { model, controller } = setup();
  assert.equal(model.readRuntime().available, false);

  await controller.pollRequests(fakePollerReq({ query: { wait: '0', state: 'closed' } }), fakeRes());
  let runtime = model.readRuntime();
  assert.equal(runtime.available, true);
  assert.equal(runtime.gateState, 'closed');

  await controller.pollRequests(fakePollerReq({ query: { wait: '0', state: 'open' } }), fakeRes());
  assert.equal(model.readRuntime().gateState, 'open');

  // A poll that declares nothing still counts as a heartbeat, but claims no state.
  await controller.pollRequests(fakePollerReq({ query: { wait: '0' } }), fakeRes());
  runtime = model.readRuntime();
  assert.equal(runtime.available, true);
  assert.equal(runtime.gateState, 'unknown');
});

test('a press wakes a poll that was already waiting', async () => {
  const { model, access, controller } = setup();

  const res = fakeRes();
  const polling = controller.pollRequests(fakePollerReq({ query: { wait: '5', state: 'closed' } }), res);

  // The guest presses a moment later, exactly as the real controller does.
  setTimeout(() => {
    model.createRequest({ accessId: access.id, deviceId: 'phone-a' });
    gateQueue.notify();
  }, 20);

  const started = Date.now();
  await polling;
  const waited = Date.now() - started;

  assert.ok(res.body.request, 'the poll came back with work');
  assert.ok(waited < 4000, `answered on the press (${waited} ms), not at the timeout`);
});

test('a poll woken for a request someone else claimed answers null rather than lying', async () => {
  const { model, access, controller } = setup();

  const res = fakeRes();
  const polling = controller.pollRequests(fakePollerReq({ query: { wait: '5', state: 'closed' } }), res);

  setTimeout(() => {
    model.createRequest({ accessId: access.id });
    model.claimNextRequest();   // a second poller got there first
    gateQueue.notify();
  }, 20);

  await polling;
  assert.deepEqual(res.body, { request: null });
});

test('the wait is clamped so a long poll always ends before the proxy gives up', () => {
  const { controller } = setup();
  const { parseWaitMs, MAX_WAIT_S } = controller.__test;

  assert.equal(parseWaitMs('25'), 25000);
  assert.equal(parseWaitMs(undefined), 25000, 'the default');
  assert.equal(parseWaitMs('nonsense'), 25000);
  assert.equal(parseWaitMs('-4'), 25000);
  assert.equal(parseWaitMs('0'), 0);
  assert.equal(parseWaitMs('600'), MAX_WAIT_S * 1000, 'clamped under Caddy\'s read timeout');
});

// --- the answer coming back ---

test('the recipe reports the outcome, once, and it lands in the journal', () => {
  const { model, access, controller } = setup();
  const { request } = model.createRequest({ accessId: access.id, deviceId: 'phone-a' });

  const res = fakeRes();
  controller.reportResult(fakePollerReq({ params: { id: request.id }, body: { status: 'opened' } }), res);

  assert.equal(res.statusCode, 204);
  assert.equal(model.getRequest(request.id).status, 'opened');
  assert.ok(model.listEvents(access.id).some((e) => e.kind === 'opened'));
});

test('a retry after a lost response is a no-op, and still says 204', () => {
  const { model, access, controller } = setup();
  const { request } = model.createRequest({ accessId: access.id });
  controller.reportResult(fakePollerReq({ params: { id: request.id }, body: { status: 'opened' } }), fakeRes());

  const retry = fakeRes();
  controller.reportResult(fakePollerReq({ params: { id: request.id }, body: { status: 'error', detail: 'late' } }), retry);

  assert.equal(retry.statusCode, 204);
  assert.equal(model.getRequest(request.id).status, 'opened', 'the first answer stands');
  assert.equal(model.listEvents(access.id).filter((e) => e.kind === 'opened').length, 1,
    'and the journal is not written twice');
});

test('a refusal carries its reason to the guest, truncated but honest', () => {
  const { model, access, controller } = setup();
  const { request } = model.createRequest({ accessId: access.id });

  controller.reportResult(fakePollerReq({
    params: { id: request.id },
    body: { status: 'refused', detail: 'x'.repeat(400) },
  }), fakeRes());

  const stored = model.getRequest(request.id);
  assert.equal(stored.status, 'refused');
  assert.equal(stored.detail.length, 300);
});

test('a status the page has no wording for is refused at the door', () => {
  const { model, access, controller } = setup();
  const { request } = model.createRequest({ accessId: access.id });

  const res = fakeRes();
  controller.reportResult(fakePollerReq({ params: { id: request.id }, body: { status: 'peut-être' } }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'INVALID_STATUS');
  assert.deepEqual(res.body.error.allowed, ['opened', 'already_open', 'refused', 'error']);
  assert.equal(model.getRequest(request.id).status, 'pending', 'nothing was written');
});

test('an unknown request id is 404, not a silent 204', () => {
  const { controller } = setup();
  const res = fakeRes();
  controller.reportResult(fakePollerReq({ params: { id: 987654 }, body: { status: 'opened' } }), res);
  assert.equal(res.statusCode, 404);
});
