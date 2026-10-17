// specs/hosting-h2-account-security.md rules 12-14 — the console's side of support access: the
// request is signed and written next to the licence, a new one replaces the pending reason, the state
// is read from the instance's database, and « Ouvrir l'espace » mints a 2-minute single-use link only
// while the customer's access is open — and it is the instance's own verifier that accepts it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { makeContext, makeInstance, NEW_CUSTOMER } = require('./helpers');
const { supportAccess } = require('../utils/gf');

const SUPPORT_TABLE = `CREATE TABLE support_access (id INTEGER PRIMARY KEY AUTOINCREMENT, requestId TEXT NOT NULL UNIQUE, reason TEXT NOT NULL,
  requestedAt TEXT NOT NULL, decision TEXT, decidedBy INTEGER, decidedAt TEXT, expiresAt TEXT, revokedAt TEXT, revokedBy INTEGER)`;

async function setup() {
  const h = makeContext();
  const dataDir = makeInstance(h.root, 'aulnes', { users: [{ email: 'claire@aulnes.fr' }] });
  const db = new Database(path.join(dataDir, 'guestflow.db'));
  db.exec(SUPPORT_TABLE);
  db.close();
  const c = await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'adrien@adn-dev.fr');
  const instanceDb = () => new Database(path.join(dataDir, 'guestflow.db'));
  // What the instance does with the file (server/src/utils/supportAccess.js readRequest).
  const instanceReads = () => supportAccess.readRequest({ dataDir, publicKey: h.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'), slug: 'aulnes' });
  return { h, c, dataDir, instanceDb, instanceReads, support: h.ctx.controllers.support };
}

test('rule 12 — the request is signed with the licence key and written next to the licence', async () => {
  const { h, c, instanceReads, support } = await setup();
  try {
    assert.equal(support.state(c.id).state, 'none');
    assert.throws(() => support.request(c.id, { reason: '  ' }, 'op'), (e) => e.body.errors.reason === 'Motif obligatoire.');
    support.request(c.id, { reason: 'Vérifier la synchronisation Booking' }, 'adrien@adn-dev.fr');
    const read = instanceReads();
    assert.equal(read.reason, 'Vérifier la synchronisation Booking');
    assert.match(read.requestId, /^[0-9a-f-]{36}$/);
    const history = h.ctx.models.audit.forCustomer(c.id);
    assert.equal(history[0].text, 'Accès du support demandé : « Vérifier la synchronisation Booking ».');
  } finally {
    h.cleanup();
  }
});

test('edge case — a second request replaces the file with a new id and the new reason', async () => {
  const { h, c, instanceReads, support } = await setup();
  try {
    support.request(c.id, { reason: 'Premier motif' }, 'op');
    const first = instanceReads();
    support.request(c.id, { reason: 'Second motif' }, 'op');
    const second = instanceReads();
    assert.notEqual(first.requestId, second.requestId);
    assert.equal(second.reason, 'Second motif');
  } finally {
    h.cleanup();
  }
});

test('rule 13 — the console reads the pending request and the open access from the instance', async () => {
  const { h, c, instanceDb, support } = await setup();
  try {
    const db = instanceDb();
    db.prepare("INSERT INTO support_access (requestId, reason, requestedAt) VALUES ('r1', 'Motif', '2026-09-29T09:00:00Z')").run();
    assert.equal(support.state(c.id).state, 'pending');
    assert.equal(support.state(c.id).canOpen, false);
    db.prepare("UPDATE support_access SET decision = 'accepted', decidedAt = '2026-09-29T09:30:00Z', expiresAt = '2026-09-30T09:30:00Z'").run();
    const open = support.state(c.id);
    assert.equal(open.state, 'open');
    assert.equal(open.stateLabel, 'Ouvert jusqu’au 30/09/2026 11:30');
    assert.throws(() => support.request(c.id, { reason: 'Encore' }, 'op'), (e) => e.body.error === 'ALREADY_OPEN');
    db.prepare("UPDATE support_access SET revokedAt = '2026-09-29T09:45:00Z'").run();
    db.close();
    const revoked = support.state(c.id);
    assert.equal(revoked.state, 'none');
    assert.equal(revoked.lastLabel, 'Dernier accès révoqué le 29/09/2026 11:45.');
  } finally {
    h.cleanup();
  }
});

test('rule 14 — « Ouvrir l\'espace » mints a link the instance verifies: 2 minutes, only while open', async () => {
  const { h, c, instanceDb, support } = await setup();
  try {
    assert.throws(() => support.link(c.id, 'op'), (e) => e.body.error === 'NOT_OPEN');
    const db = instanceDb();
    db.prepare("INSERT INTO support_access (requestId, reason, requestedAt, decision, decidedAt, expiresAt) VALUES ('r1', 'Motif', '2026-09-29T09:00:00Z', 'accepted', '2026-09-29T09:30:00Z', '2026-09-30T09:30:00Z')").run();
    db.close();
    const { url, validSeconds } = support.link(c.id, 'adrien@adn-dev.fr');
    assert.equal(validSeconds, 120);
    assert.match(url, /^https:\/\/aulnes\.guestflow\.test\/api\/auth\/support\?token=/);
    const token = decodeURIComponent(url.split('token=')[1]);
    const publicKey = h.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const payload = supportAccess.verifyLink(token, { publicKey, slug: 'aulnes', now: h.now() });
    assert.equal(payload.accessId, 1);
    assert.throws(() => supportAccess.verifyLink(token, { publicKey, slug: 'aulnes', now: new Date(h.now().getTime() + 120001) }), /expired/);
    assert.equal(h.ctx.models.audit.forCustomer(c.id)[0].text, 'Espace du client ouvert par le support.');
  } finally {
    h.cleanup();
  }
});

test('rule 17 — an instance the console cannot read offers nothing', async () => {
  const { h, c, dataDir, support } = await setup();
  try {
    fs.rmSync(path.join(dataDir, 'guestflow.db'));
    const state = support.state(c.id);
    assert.equal(state.available, false);
    assert.throws(() => support.request(c.id, { reason: 'x' }, 'op'), (e) => e.body.error === 'UNAVAILABLE');
  } finally {
    h.cleanup();
  }
});
