const test = require('node:test');
const assert = require('node:assert/strict');

const { makeGateDb, insertStay, makeModel } = require('./gateFixtures');

// specs/guest-gate-access.md §3.8 — the gîte and the lodge, two stays, ONE gate.

function twoLodgings(startIso = '2026-09-12T17:00:00.000Z') {
  const db = makeGateDb();
  // The lodge is occupied for the week, the gîte for the weekend: both live at once.
  const gite = insertStay(db, { propertyId: 1, startDate: '2026-09-12', endDate: '2026-09-14' });
  const lodge = insertStay(db, { propertyId: 2, startDate: '2026-09-10', endDate: '2026-09-17' });
  const { model, clock } = makeModel(db, startIso);
  return {
    db, model, clock,
    giteAccess: model.ensureForReservation(gite),
    lodgeAccess: model.ensureForReservation(lodge),
    gite, lodge,
  };
}

test('two accesses live side by side, and each code resolves to its own stay', () => {
  const { model, giteAccess, lodgeAccess, gite, lodge } = twoLodgings();

  assert.notEqual(giteAccess.code, lodgeAccess.code);
  assert.equal(model.findByCode(giteAccess.code).reservation.id, gite);
  assert.equal(model.findByCode(lodgeAccess.code).reservation.id, lodge);
  assert.equal(model.findByCode(giteAccess.code).state, 'active');
  assert.equal(model.findByCode(lodgeAccess.code).state, 'active');
});

test('each stay keeps its own window: the gîte expires while the lodge stays open', () => {
  const { model, clock, giteAccess, lodgeAccess } = twoLodgings();

  clock.set('2026-09-14T10:00:00.000Z'); // 12:00 Paris on the 14th — gîte checked out at 10:00 + 1 h
  assert.equal(model.resolve(giteAccess.id).state, 'after');
  assert.equal(model.resolve(lodgeAccess.id).state, 'active');
  assert.ok(model.findByCode(lodgeAccess.code));

  // A code that just expired MUST still resolve, carrying state 'after': that is what lets the page
  // say « votre séjour est terminé » instead of « code incorrect » to a guest who presses in the car
  // park an hour late. The 401 is reserved for a code that matches nothing at all.
  const justExpired = model.findByCode(giteAccess.code);
  assert.ok(justExpired, 'still found, on purpose');
  assert.equal(justExpired.state, 'after');
});

test('a code stops being found at all once the stay is well behind us', () => {
  const { model, clock, giteAccess } = twoLodgings();

  clock.set('2026-09-15T12:00:00.000Z');
  assert.ok(model.findByCode(giteAccess.code), 'the day after check-out: still an honest answer');

  clock.set('2026-09-20T12:00:00.000Z');
  assert.equal(model.findByCode(giteAccess.code), null,
    'a week later it is indistinguishable from a code that never existed');
});

test('requests are served one at a time, in the order they were pressed', () => {
  const { model, clock, giteAccess, lodgeAccess } = twoLodgings();

  const first = model.createRequest({ accessId: giteAccess.id, deviceId: 'gite-phone' });
  clock.advance(2000);
  const second = model.createRequest({ accessId: lodgeAccess.id, deviceId: 'lodge-phone' });

  assert.equal(second.deduped, false, 'the other lodging is NOT a duplicate — different access');

  const claimedFirst = model.claimNextRequest();
  assert.equal(claimedFirst.id, first.request.id, 'the gîte pressed first');

  const claimedSecond = model.claimNextRequest();
  assert.equal(claimedSecond.id, second.request.id);
  assert.equal(model.claimNextRequest(), null);
});

test('the gate-wide ceiling counts both lodgings, the per-access one does not', () => {
  const { model, clock, giteAccess, lodgeAccess } = twoLodgings();

  for (let i = 0; i < 4; i += 1) {
    const g = model.createRequest({ accessId: giteAccess.id });
    model.resolveRequest(g.request.id, 'opened');
    const l = model.createRequest({ accessId: lodgeAccess.id });
    model.resolveRequest(l.request.id, 'opened');
    clock.advance(11 * 1000);
  }

  assert.equal(model.countOpensSince(giteAccess.id), 4);
  assert.equal(model.countOpensSince(lodgeAccess.id), 4);
  assert.equal(model.countGateOpensSince(), 8, 'the gate saw eight');
  assert.ok(model.OPENS_PER_HOUR_PER_GATE > model.OPENS_PER_HOUR_PER_ACCESS,
    'one lodging must not be able to starve the other');
});

test('revoking one lodging leaves the other untouched', () => {
  const { model, giteAccess, lodgeAccess } = twoLodgings();
  model.revoke(giteAccess.id);

  assert.equal(model.findByCode(giteAccess.code), null);
  assert.ok(model.findByCode(lodgeAccess.code), 'the lodge guest keeps their evening');
});

// --- what the house last told us (§3.5 rule 19.bis) ---

test('with no heartbeat at all, nothing is available and no state is claimed', () => {
  const { model } = twoLodgings();
  const runtime = model.readRuntime();

  assert.equal(runtime.available, false);
  assert.equal(runtime.gateState, 'unknown');
  assert.equal(runtime.pollerSeenAt, null);
});

test('a heartbeat carries the state the plugin sees, and both go stale together', () => {
  const { model, clock } = twoLodgings();

  model.noteHeartbeat({ state: 'closed' });
  let runtime = model.readRuntime();
  assert.equal(runtime.available, true);
  assert.equal(runtime.gateState, 'closed');

  clock.advance(30 * 1000);
  assert.equal(model.readRuntime().available, true, 'half a minute is still alive');

  clock.advance(35 * 1000);
  runtime = model.readRuntime();
  assert.equal(runtime.available, false, 'past a minute the house is presumed unreachable');
  assert.equal(runtime.gateState, 'unknown',
    'and a stale "closed" must never invite a press the recipe would refuse');
});

test('an unknown state string is not trusted into the column', () => {
  const { model } = twoLodgings();
  model.noteHeartbeat({ state: 'grand ouvert' });
  assert.equal(model.readRuntime().gateState, 'unknown');
  assert.equal(model.readRuntime().available, true, 'the poller is still alive, though');
});

test('the state follows the gate: closed, then open once someone drove in', () => {
  const { model, clock } = twoLodgings();

  model.noteHeartbeat({ state: 'closed' });
  assert.equal(model.readRuntime().gateState, 'closed');

  clock.advance(5 * 1000);
  model.noteHeartbeat({ state: 'open' });
  assert.equal(model.readRuntime().gateState, 'open');
});

// --- housekeeping (§3.7 rule 24) ---

test('the purge nulls the clear code a week after the stay, and keeps the journal', () => {
  const { model, clock, giteAccess } = twoLodgings();
  model.appendEvent({ accessId: giteAccess.id, kind: 'open', reason: 'ok' });

  clock.set('2026-09-16T12:00:00.000Z'); // two days after check-out
  assert.equal(model.purge().codes, 0, 'too early — the operator may still be dictating it');

  clock.set('2026-09-25T12:00:00.000Z'); // eleven days after
  const purged = model.purge();
  assert.ok(purged.codes >= 1);
  assert.equal(model.resolve(giteAccess.id).access.code, null, 'the clear code is gone');
  assert.ok(model.resolve(giteAccess.id).access.codeHash, 'the hash stays — the row is still a record');
  assert.ok(model.listEvents(giteAccess.id).length >= 1, 'the journal survives the code');
});

test('the journal outlives the access itself', () => {
  const { db, model, giteAccess } = twoLodgings();
  model.appendEvent({ accessId: giteAccess.id, kind: 'open' });

  db.prepare('DELETE FROM gate_accesses WHERE id = ?').run(giteAccess.id);

  const rows = db.prepare('SELECT * FROM gate_events WHERE accessId = ?').all(giteAccess.id);
  assert.ok(rows.length >= 1, 'no foreign key means the answer to "who came in that night" remains');
});
