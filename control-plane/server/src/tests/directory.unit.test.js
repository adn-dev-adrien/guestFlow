// specs/control-plane-plans-and-access.md rule 26 — the directory: the console reads each instance's
// active accounts, keeps only their HMAC, replaces them at each read, keeps what it had when an
// instance cannot be read, and forgets an erased customer.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Database = require('better-sqlite3');
const { makeContext, makeInstance, NEW_CUSTOMER } = require('./helpers');
const { emailHmac } = require('../utils/directory');

test('rule 26 — active accounts only, normalised, and never an email in clear', async () => {
  const h = makeContext();
  try {
    makeInstance(h.root, 'aulnes', { users: [{ email: 'Gerant@Aulnes.fr ' }, { email: 'parti@aulnes.fr', isActive: false }] });
    const c = await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
    assert.equal(h.ctx.controllers.login.readDirectory(), 1);
    const rows = h.ctx.db.prepare('SELECT * FROM directory').all();
    assert.deepEqual(rows.map((r) => [r.emailHmac, r.customerId]), [[emailHmac(h.ctx.directoryKey, 'gerant@aulnes.fr'), c.id]]);
    const dump = JSON.stringify(h.ctx.db.prepare("SELECT * FROM sqlite_master WHERE type = 'table'").all().flatMap((t) => h.ctx.db.prepare(`SELECT * FROM ${t.name}`).all()));
    assert.ok(!/gerant@aulnes\.fr|parti@aulnes\.fr/i.test(dump), 'no account email anywhere in the console');
  } finally {
    h.cleanup();
  }
});

test('rule 26 — the next read replaces; an unreadable instance keeps its pairs; erasure removes them', async () => {
  const h = makeContext();
  try {
    const dataDir = makeInstance(h.root, 'aulnes', { users: [{ email: 'claire@aulnes.fr' }] });
    const c = await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
    const login = h.ctx.controllers.login;
    login.readDirectory();
    const db = new Database(path.join(dataDir, 'guestflow.db'));
    db.exec("UPDATE users SET isActive = 0; INSERT INTO users (email) VALUES ('jo@aulnes.fr')");
    db.close();
    login.readDirectory();
    assert.equal(login.lookup('claire@aulnes.fr').kind, 'none');
    assert.equal(login.lookup('jo@aulnes.fr').kind, 'one');

    require('fs').renameSync(path.join(dataDir, 'guestflow.db'), path.join(dataDir, 'moved.db'));
    login.readDirectory();
    assert.equal(login.lookup('jo@aulnes.fr').kind, 'one', 'kept while the instance cannot be read');

    await h.ctx.controllers.customers.deprovision(c.id, { confirmSlug: 'aulnes' }, 'op');
    assert.equal(login.lookup('jo@aulnes.fr').kind, 'one', 'an archived space stays findable');
    h.ctx.controllers.customers.eraseNow(c.id, { confirmSlug: 'aulnes' }, 'op');
    assert.equal(h.ctx.models.directory.count(c.id), 0);
    assert.equal(login.lookup('jo@aulnes.fr').kind, 'none');
  } finally {
    h.cleanup();
  }
});
