// specs/hosting-h2-account-security.md rule 26 — right after « Demander l'accès » the console shows
// « En attente », not « Aucun accès »: a request it wrote and the instance has not imported yet is
// already pending. Once the instance imported it, the instance's own row is the state again.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { makeContext, makeInstance, NEW_CUSTOMER } = require('./helpers');
const { supportAccess } = require('../utils/gf');

const SUPPORT_TABLE = `CREATE TABLE support_access (id INTEGER PRIMARY KEY AUTOINCREMENT, requestId TEXT NOT NULL UNIQUE, reason TEXT NOT NULL,
  requestedAt TEXT NOT NULL, decision TEXT, decidedBy INTEGER, decidedAt TEXT, expiresAt TEXT, revokedAt TEXT, revokedBy INTEGER)`;

test('rule 26 — the request just written reads « En attente » before the instance imports it', async () => {
  const h = makeContext();
  try {
    const dataDir = makeInstance(h.root, 'aulnes', { users: [{ email: 'claire@aulnes.fr' }] });
    const db = new Database(path.join(dataDir, 'guestflow.db'));
    db.exec(SUPPORT_TABLE);
    db.close();
    const c = await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
    const { support } = h.ctx.controllers;
    const after = support.request(c.id, { reason: 'Vérifier Booking' }, 'op');
    assert.equal(after.state, 'pending');
    assert.equal(after.stateLabel, 'En attente de réponse : « Vérifier Booking »');

    // The instance imports it, then refuses it: its row decides.
    const publicKey = h.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const read = supportAccess.readRequest({ dataDir, publicKey, slug: 'aulnes' });
    const inst = new Database(path.join(dataDir, 'guestflow.db'));
    inst.prepare("INSERT INTO support_access (requestId, reason, requestedAt, decision, decidedAt) VALUES (?, ?, ?, 'refused', '2026-09-29T10:05:00Z')")
      .run(read.requestId, read.reason, read.requestedAt);
    inst.close();
    const refused = support.state(c.id);
    assert.equal(refused.state, 'none');
    assert.equal(refused.lastLabel, 'Dernière demande refusée le 29/09/2026 12:05.');
  } finally {
    h.cleanup();
  }
});

test('rule 26 — a request file that is a link out of the instance is never read', async () => {
  const h = makeContext();
  try {
    const dataDir = makeInstance(h.root, 'aulnes', { users: [{ email: 'claire@aulnes.fr' }] });
    const db = new Database(path.join(dataDir, 'guestflow.db'));
    db.exec(SUPPORT_TABLE);
    db.close();
    const c = await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
    const { support } = h.ctx.controllers;
    support.request(c.id, { reason: 'Vérifier Booking' }, 'op');
    const file = path.join(dataDir, supportAccess.REQUEST_FILE);
    const outside = path.join(h.dataDir, 'planted.jws');
    fs.copyFileSync(file, outside);
    fs.rmSync(file);
    fs.symlinkSync(outside, file);
    assert.equal(support.state(c.id).state, 'none');
  } finally {
    h.cleanup();
  }
});
