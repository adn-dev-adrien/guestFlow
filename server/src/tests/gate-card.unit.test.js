const test = require('node:test');
const assert = require('node:assert/strict');

const { makeGateDb, insertStay, makeModel, withMocks } = require('./gateFixtures');

// specs/guest-gate-access.md §3.6 rule 21 — the « Accès portail » card on the reservation fiche:
// the code, the window, the devices, the last use, the journal, and the two guarded actions.
//
// It had no test until 2026-09-14, and it was the spec-coverage barrier that said so. The card is
// the owner's main surface on this feature — it is where a code gets read out on the phone and
// where an access gets killed — so « it renders » is not enough: what it CARRIES is the contract.

function loadCard(db, model, { base = 'https://guest.test' } = {}) {
  return withMocks({
    '../models/gateAccessModel': model,
    '../middleware/requireGuestHost': { guestBaseUrl: () => base },
  }, () => {
    delete require.cache[require.resolve('../utils/gateAccessCard')];
    return require('../utils/gateAccessCard');
  });
}

function setup({ startIso = '2026-09-13T09:00:00.000Z', stay = {} } = {}) {
  const db = makeGateDb();
  const stayId = insertStay(db, stay);
  const { model, clock } = makeModel(db, startIso);
  const { buildGateAccessCard } = loadCard(db, model);
  delete require.cache[require.resolve('../utils/gateAccessCard')];
  return { db, model, clock, stayId, card: () => buildGateAccessCard(stayId) };
}

test('the card carries the dictable code, the window in words, and the guest link', () => {
  const { card, model, stayId } = setup();
  const access = model.ensureForReservation(stayId);
  const shown = card();

  assert.equal(shown.accessId, access.id);
  assert.match(shown.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/, 'grouped by four, as it is read out loud');
  assert.equal(shown.code.replace('-', ''), access.code);
  assert.equal(shown.url, `https://guest.test/?c=${access.code}`);
  assert.equal(shown.permanentUrl, 'https://guest.test', 'the QR at the gate carries no secret');
  assert.equal(shown.state, 'active');
  assert.equal(shown.window.label, '12/09 16:00 → 14/09 11:00', 'check-in → check-out + 1 h');
  assert.equal(shown.revokedAt, null);
  assert.deepEqual(shown.devices, []);
  assert.equal(shown.deviceCount, 0);
});

test('reading the card is what brings the access into being — once', () => {
  // Rule 1, seen from this side: the code is minted the first time anyone needs to show it. Two
  // reads must not mint two codes, or the link already emailed would die on a fiche being opened.
  const { card, db } = setup();
  const first = card();
  const second = card();

  assert.equal(first.code, second.code);
  assert.equal(first.accessId, second.accessId);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gate_accesses').get().n, 1);
});

test('a devis and a cancelled stay have no card at all', () => {
  assert.equal(setup({ stay: { kind: 'devis' } }).card(), null);
  assert.equal(setup({ stay: { cancelledAt: '2026-09-11T08:00:00.000Z' } }).card(), null);
});

test('the card shows the devices and the journal, newest first', () => {
  const { card, model, stayId, clock } = setup();
  const access = model.ensureForReservation(stayId);

  model.touchDevice(access.id, 'phone-1', { ip: '203.0.113.7', userAgent: 'iPhone' });
  clock.advance(60 * 1000);
  model.touchDevice(access.id, 'phone-2', { ip: '203.0.113.9', userAgent: 'Android' });
  model.appendEvent({ accessId: access.id, kind: 'open_ok', reason: 'le portail a bougé' });

  const shown = card();
  assert.equal(shown.deviceCount, 2, 'the brother-in-law is counted, never refused (rule 15)');
  assert.deepEqual(shown.devices.map((d) => d.userAgent).sort(), ['Android', 'iPhone']);
  assert.ok(shown.events.length >= 2, 'the creation and the opening are both there');
  assert.equal(shown.events[0].kind, 'open_ok');
  assert.equal(shown.events[0].reason, 'le portail a bougé');
});

test('revoking shows on the card, and the code stops being offered', () => {
  const { card, model, stayId } = setup();
  const access = model.ensureForReservation(stayId);
  model.revoke(access.id);

  const shown = card();
  assert.equal(shown.state, 'revoked');
  assert.ok(shown.revokedAt, 'the fiche says when, not just that');
  assert.equal(shown.url, null, 'no link to hand out for a dead access');
});

test('regenerating gives the card a new code and forgets the phones', () => {
  const { card, model, stayId } = setup();
  const access = model.ensureForReservation(stayId);
  model.touchDevice(access.id, 'phone-1', { ip: '203.0.113.7', userAgent: 'iPhone' });
  const before = card().code;

  model.regenerate(access.id);
  const after = card();

  assert.notEqual(after.code, before);
  assert.equal(after.deviceCount, 0, 'the link already sent is dead, and so are its devices');
});

test('once the purge has cleared the code, the card is a record and no longer a secret', () => {
  const { card, model, stayId, clock } = setup();
  model.ensureForReservation(stayId);

  clock.set('2026-09-25T09:00:00.000Z');       // well past the seven days of §3.7
  model.purge();

  const shown = card();
  assert.equal(shown.code, null);
  assert.equal(shown.url, null);
  assert.ok(shown.events.length >= 1, 'but the journal stays — « qui est entré cette nuit-là »');
});

test('the card tells the operator whether the house is even reachable', () => {
  // So that « ça ne marche pas » can be told apart from « the gate is already open » without
  // opening a terminal. This is the one place the contact is still shown — never to the guest
  // (§3.5 rule 19.ter).
  const { card, model } = setup();
  assert.deepEqual(card().service, { available: false, gateState: 'unknown' });

  model.noteHeartbeat({ state: 'open' });
  assert.deepEqual(card().service, { available: true, gateState: 'open' });
});
