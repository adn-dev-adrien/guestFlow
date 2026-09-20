// The local copy of the invitation — specs/gate-access-sowel-connector.md §3.2 and §3.4,
// rules 9-11 + rules 20, 21 and 23.
//
// It is a copy: nothing here is authoritative and nothing here opens a gate. What is checked is
// that a dead code is never shown, and that no surface has to reach the house.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const createGateInvitationModel = require('../models/gateInvitationModel');
const view = require('../utils/gateInvitationView');

const DDL = `
  CREATE TABLE gate_invitations (
    reservationId INTEGER PRIMARY KEY, accessId TEXT, state TEXT NOT NULL, code TEXT, url TEXT,
    validFrom TEXT, validUntil TEXT, devices INTEGER NOT NULL DEFAULT 0, lastUsedAt TEXT,
    updatedAt TEXT, receivedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

const invitation = (over = {}) => ({
  reservationId: 42,
  accessId: 'a1',
  state: 'active',
  code: '4K7M-9QT2',
  url: 'https://sowel.example.com/p/guest-access/#i=4K7M9QT2',
  validFrom: '2026-09-04T16:00:00.000Z',
  validUntil: '2026-09-11T09:00:00.000Z',
  devices: 2,
  lastUsedAt: '2026-09-06T18:12:00.000Z',
  updatedAt: '2026-09-06T18:12:00.000Z',
  ...over,
});

function setup() {
  const db = new Database(':memory:');
  db.exec(DDL);
  return { db, model: createGateInvitationModel(db) };
}

test('what the house pushes replaces what was there', () => {
  const { db, model } = setup();
  model.upsert(invitation());
  model.upsert(invitation({ code: 'ZZZZ-1111', devices: 5 }));

  const rows = db.prepare('SELECT * FROM gate_invitations').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, 'ZZZZ-1111');
  assert.equal(rows[0].devices, 5);
});

test('a row with no reservation id is ignored, not half-written', () => {
  const { db, model } = setup();
  assert.equal(model.upsert({ state: 'active' }), null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gate_invitations').get().n, 0);
});

test('a deleted, revoked or finished access is no longer shown', () => {
  const { db, model } = setup();
  for (const state of ['deleted', 'revoked', 'ended']) {
    model.upsert(invitation({ state }));
    assert.equal(view.usableInvitation(db, 42), null, state);
  }
  model.upsert(invitation({ state: 'suspended' }));
  // On hold is shown: the guest still has their code, it is the gate that will refuse — and the
  // house will say so in its own words.
  assert.ok(view.usableInvitation(db, 42));
});

test('with no code, there is nothing to show', () => {
  const { db, model } = setup();
  model.upsert(invitation({ code: null }));
  assert.equal(view.usableInvitation(db, 42), null);
});

test('a missing table answers « no access » rather than blowing up', () => {
  // That is the case of the other suites' minimal schemas: they do not know this table.
  const bare = new Database(':memory:');
  assert.equal(view.readInvitation(bare, 42), null);
  assert.equal(view.usableInvitation(bare, 42), null);
  assert.deepEqual(view.ficheCard(bare, 42), { configured: false });
});

test('the fiche says the state in French, and what the guest holds', () => {
  const { db, model } = setup();
  model.upsert(invitation());
  const card = view.ficheCard(db, 42);
  assert.equal(card.configured, true);
  assert.equal(card.stateLabel, 'Actif');
  assert.equal(card.code, '4K7M-9QT2');
  assert.equal(card.devices, 2);
  assert.equal(card.deleted, false);
  assert.match(card.windowLabel, /^Du .* au .*$/);
});

test('an access deleted from the list is visible on the fiche', () => {
  const { db, model } = setup();
  model.upsert(invitation({ state: 'deleted' }));
  const card = view.ficheCard(db, 42);
  assert.equal(card.deleted, true);
  assert.equal(card.stateLabel, 'Supprimé dans la liste');
});

test('the window reads on the Paris clock, not on UTC', () => {
  const label = view.windowLabel({
    validFrom: '2026-09-04T16:00:00.000Z',
    validUntil: '2026-09-11T09:00:00.000Z',
  });
  // 16:00 UTC in September = 18:00 in Paris.
  assert.match(label, /18:00/);
  assert.match(label, /11:00/);
});

test('the SAS gets the code and a QR of the very address the email carries', async () => {
  const { db, model } = setup();
  model.upsert(invitation());
  const step = await view.sasStep(db, 42);
  assert.equal(step.status, 'ok');
  assert.equal(step.code, '4K7M-9QT2');
  assert.ok(step.qrDataUri.startsWith('data:image/png;base64,'));
  assert.ok(step.windowLabel.length > 0);
});

test('the SAS says when the house has sent nothing yet', async () => {
  const { db } = setup();
  const step = await view.sasStep(db, 42);
  assert.equal(step.status, 'not_received');
});

test('and when what it sent is no longer showable', async () => {
  const { db, model } = setup();
  model.upsert(invitation({ state: 'revoked' }));
  const step = await view.sasStep(db, 42);
  assert.equal(step.status, 'unusable');
  assert.equal(step.state, 'revoked');
});

test('the link is taken as it comes: an alias of the house is shown unchanged', async () => {
  // Rule 10 — the address belongs to the house. A gîte that fronts Sowel with a name of its own
  // pushes `https://acces.domainesolio.com/#i=CODE`, and nothing here may recognise, rebuild or
  // « fix » it into the `/p/guest-access/` shape.
  const { db, model } = setup();
  const url = 'https://acces.domainesolio.com/#i=4K7M9QT2';
  model.upsert(invitation({ url }));

  const step = await view.sasStep(db, 42);
  assert.equal(step.url, url);
  assert.ok(step.qrDataUri.startsWith('data:image/png;base64,'));
  assert.equal(view.ficheCard(db, 42).url, url);
});
