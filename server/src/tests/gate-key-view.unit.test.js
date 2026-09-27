// What guestFlow shows of a stay's gate key — specs/gate-access-sowel-connector.md §3.5.
//
// A dead code is never shown, and no surface has to reach the house.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { freshDb } = require('./gateKeysFixtures');
const view = require('../utils/gateInvitationView');

function withResult(over = {}) {
  const { db, model } = freshDb();
  model.upsertResult({
    reservationId: 42, action: 'create', ok: true, state: 'not_yet',
    code: '4K7M-9QT2', url: 'https://acces.domainesolio.com/#i=4K7M9QT2',
    label: 'Gîte · R-2026-041 · Marie', startsAt: '2026-10-01T13:00:00.000Z', endsAt: '2026-10-04T09:00:00.000Z',
    receivedAt: '2026-09-27T18:00:00.000Z',
    ...over,
  });
  return db;
}

// specs/gate-access-sowel-connector.md §3.5 rule 28
test('a revoked, ended or gateless key is never usable, nor a failed one', () => {
  for (const state of ['revoked', 'ended', 'no_gate']) {
    assert.equal(view.usableInvitation(withResult({ state }), 42), null, state);
  }
  assert.equal(view.usableInvitation(withResult({ ok: false, error: 'unknown_profile', code: null, url: null }), 42), null);
  assert.equal(view.usableInvitation(withResult({ action: 'revoke', state: 'revoked' }), 42), null);
  assert.equal(view.usableInvitation(withResult({ code: null, url: null }), 42), null);
});

// specs/gate-access-sowel-connector.md §3.5 rule 23 — every living state is shown.
test('a key that is live, outside hours, not yet valid or suspended is usable', () => {
  for (const state of ['live', 'outside_hours', 'not_yet', 'suspended']) {
    assert.equal(view.usableInvitation(withResult({ state }), 42).code, '4K7M-9QT2', state);
  }
});

// specs/gate-access-sowel-connector.md §3.2 rule 10 — the link is opaque.
test('the link is shown exactly as the house handed it', () => {
  const url = 'https://acces.domainesolio.com/#i=4K7M9QT2&x=%20y';
  assert.equal(view.usableInvitation(withResult({ url }), 42).url, url);
});

// specs/gate-access-sowel-connector.md §3.5 rule 26 — the fiche card.
test('the fiche card shows the state, the window and the code', () => {
  const card = view.ficheCard(withResult({ state: 'live' }), 42);
  assert.equal(card.configured, true);
  assert.equal(card.ok, true);
  assert.equal(card.stateLabel, 'Actif');
  assert.equal(card.code, '4K7M-9QT2');
  assert.match(card.windowLabel, /^Du jeudi 1 octobre à 15:00 au dimanche 4 octobre à 11:00$/);
});

// specs/gate-access-sowel-connector.md §3.5 rule 26 — a failure is said, with its reason.
test('the fiche card says « Échec » and why when the key could not be made', () => {
  const card = view.ficheCard(withResult({ ok: false, error: 'profile_incomplete', code: null, url: null, state: null }), 42);
  assert.equal(card.stateLabel, 'Échec');
  assert.equal(card.reason, 'le profil par défaut ne liste aucun portail');
  assert.equal(card.code, null);
});

// specs/gate-access-sowel-connector.md §3.5 rule 26 — nothing when there is nothing.
test('no result, or no table at all, renders nothing', () => {
  const { db } = freshDb();
  assert.deepEqual(view.ficheCard(db, 42), { configured: false });
  const bare = new Database(':memory:');
  assert.deepEqual(view.ficheCard(bare, 42), { configured: false });
  assert.equal(view.usableInvitation(bare, 42), null);
});

// specs/gate-access-sowel-connector.md §3.5 rule 24 — the SAS step and its QR.
test('the SAS step carries the code and a QR of the very link', async () => {
  const step = await view.sasStep(withResult(), 42);
  assert.equal(step.status, 'ok');
  assert.equal(step.code, '4K7M-9QT2');
  assert.match(step.qrDataUri, /^data:image\/png;base64,/);
});

// specs/gate-access-sowel-connector.md §3.5 rule 25 — nothing usable: the SAS falls back.
test('the SAS step says why it has nothing to show', async () => {
  assert.deepEqual(await view.sasStep(freshDb().db, 42), { status: 'not_received', state: null });
  assert.deepEqual(await view.sasStep(withResult({ state: 'revoked' }), 42), { status: 'unusable', state: 'revoked' });
  const noLink = await view.sasStep(withResult({ url: null }), 42);
  assert.equal(noLink.qrDataUri, null);
  assert.equal(noLink.code, '4K7M-9QT2');
});
