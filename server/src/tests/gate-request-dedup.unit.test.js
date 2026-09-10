const test = require('node:test');
const assert = require('node:assert/strict');

const { makeGateDb, insertStay, makeModel } = require('./gateFixtures');

// specs/guest-gate-access.md §3.5 rules 17-19.
// Why this file exists at all: two pulses on a sequential gate mean open THEN CLOSE. A duplicate
// request is not a wasted call, it is a gate closing on a car.

function setup(startIso) {
  const db = makeGateDb();
  const stayId = insertStay(db);
  const { model, clock } = makeModel(db, startIso);
  const access = model.ensureForReservation(stayId);
  return { db, model, clock, access };
}

test('two presses while the first is still pending are one request', () => {
  const { model, clock, access } = setup();

  const first = model.createRequest({ accessId: access.id, deviceId: 'phone-a' });
  clock.advance(500);
  const second = model.createRequest({ accessId: access.id, deviceId: 'phone-a' });

  assert.equal(first.deduped, false);
  assert.equal(second.deduped, true);
  assert.equal(second.request.id, first.request.id);
});

test('a press from ANOTHER device on the same access is still the same request', () => {
  const { model, access } = setup();
  const first = model.createRequest({ accessId: access.id, deviceId: 'phone-a' });
  const second = model.createRequest({ accessId: access.id, deviceId: 'phone-b' });

  assert.equal(second.request.id, first.request.id, 'the family shares one gate, not one phone');
  assert.equal(second.deduped, true);
});

test('a press within ten seconds of a successful open is the same request', () => {
  const { model, clock, access } = setup();
  const first = model.createRequest({ accessId: access.id });
  model.resolveRequest(first.request.id, 'opened');

  clock.advance(9 * 1000);
  const again = model.createRequest({ accessId: access.id });
  assert.equal(again.deduped, true);
  assert.equal(again.request.id, first.request.id);
});

test('past ten seconds, a press is a new request', () => {
  const { model, clock, access } = setup();
  const first = model.createRequest({ accessId: access.id });
  model.resolveRequest(first.request.id, 'opened');

  clock.advance(11 * 1000);
  const again = model.createRequest({ accessId: access.id });
  assert.equal(again.deduped, false);
  assert.notEqual(again.request.id, first.request.id);
});

test('an already_open answer also absorbs a second press', () => {
  const { model, clock, access } = setup();
  const first = model.createRequest({ accessId: access.id });
  model.resolveRequest(first.request.id, 'already_open');

  clock.advance(3 * 1000);
  assert.equal(model.createRequest({ accessId: access.id }).deduped, true);
});

test('a refusal or an error never blocks the retry', () => {
  const { model, clock, access } = setup();

  const refused = model.createRequest({ accessId: access.id });
  model.resolveRequest(refused.request.id, 'refused', { detail: 'access disarmed' });
  clock.advance(1000);
  const retryAfterRefusal = model.createRequest({ accessId: access.id });
  assert.equal(retryAfterRefusal.deduped, false, 'the guest may press again the moment you re-arm');

  model.resolveRequest(retryAfterRefusal.request.id, 'error', { detail: 'gate did not answer' });
  clock.advance(1000);
  assert.equal(model.createRequest({ accessId: access.id }).deduped, false);
});

test('resolving is idempotent: the first answer wins and the second changes nothing', () => {
  const { model, access } = setup();
  const { request } = model.createRequest({ accessId: access.id });

  const first = model.resolveRequest(request.id, 'opened');
  const second = model.resolveRequest(request.id, 'error', { detail: 'late arrival' });

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(second.request.status, 'opened');
  assert.equal(second.request.detail, null);
  assert.equal(model.resolveRequest(999999, 'opened').changed, false, 'and an unknown id is not fatal');
});

test('a request nobody answers times out after thirty seconds', () => {
  const { model, clock, access } = setup();
  const { request } = model.createRequest({ accessId: access.id });

  clock.advance(29 * 1000);
  assert.equal(model.expireStaleRequests(), 0);
  assert.equal(model.getRequest(request.id).status, 'pending');

  clock.advance(2 * 1000);
  assert.equal(model.expireStaleRequests(), 1);
  const dead = model.getRequest(request.id);
  assert.equal(dead.status, 'timeout');
  assert.match(dead.detail, /sans réponse/);

  // And a timeout does not hold the next press hostage.
  assert.equal(model.createRequest({ accessId: access.id }).deduped, false);
});

test('claiming stamps the request so no second poller takes it', () => {
  const { model, access } = setup();
  const { request } = model.createRequest({ accessId: access.id });

  const claimed = model.claimNextRequest();
  assert.equal(claimed.id, request.id);
  assert.ok(claimed.claimedAt);
  assert.equal(model.claimNextRequest(), null, 'nothing left to claim');
});

test('the per-access ceiling counts the presses that reached the gate', () => {
  const { model, clock, access } = setup();

  for (let i = 0; i < 5; i += 1) {
    const { request } = model.createRequest({ accessId: access.id });
    model.resolveRequest(request.id, 'opened');
    clock.advance(11 * 1000);
  }
  assert.equal(model.countOpensSince(access.id), 5);

  // A refusal is not an opening, and an hour later the slate is clean.
  const { request } = model.createRequest({ accessId: access.id });
  model.resolveRequest(request.id, 'refused');
  assert.equal(model.countOpensSince(access.id), 5, 'a refusal does not eat the guest\'s allowance');

  clock.advance(61 * 60 * 1000);
  assert.equal(model.countOpensSince(access.id), 0);
});
