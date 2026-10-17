// specs/hosting-h2-account-security.md rules 21-22 — the « Support GuestFlow » account is told by a
// flag, never by its email, and nothing changes it nor recovers it as an administrator; the instance
// accepts a support request or link only for its own slug, taken from the hosting or the licence.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');
const { setup, makeDb, fakeRes, fakeSession, keyPair, withSupportRequest, supportLink, openSupportAccess } = require('./accountSecurityFixture');
const usersModelModule = require('../models/usersModel');
const { applyAccountSecuritySchema } = require('../utils/accountSecuritySchema');
const { createSupportAudit } = require('../middleware/supportAudit');
const supportTokens = require('../utils/supportAccess');
const { createLicenceReader, signLicence } = require('../utils/licence');

const SERVER = path.join(__dirname, '..', '..');
const supportRow = (db) => db.prepare('SELECT * FROM users WHERE isSupportAccount = 1').get();

test('rule 21 — the support account is told by its flag: a changed email neither hides it nor escapes the guard', () => {
  const h = withSupportRequest();
  const accessId = openSupportAccess(h);
  const opened = h.supportAccess.consumeLink(supportLink(h, accessId));
  assert.equal(opened.user.isSupport, true);
  h.db.prepare('UPDATE users SET email = ? WHERE isSupportAccount = 1').run('renamed@example.com');
  const fresh = h.users.findById(opened.user.id);
  assert.equal(fresh.isSupport, true);
  assert.ok(!h.users.list().some((u) => u.id === fresh.id), 'still never listed');

  const session = fakeSession({ user: { ...fresh, isSupport: false }, supportAccessId: accessId });
  const res = fakeRes();
  createSupportAudit({ controller: h.supportAccess })({ method: 'PUT', path: '/Users/me/', body: {}, session }, res, () => assert.fail('must not pass'));
  assert.equal(res.statusCode, 403, 'the session marker is enough');
});

test('rule 21 — no model method changes the support account: identity, email, roles, password, active flag', () => {
  const h = setup();
  const support = supportRow(h.db);
  const locked = (e) => e.code === 'SUPPORT_ACCOUNT_LOCKED';
  assert.throws(() => h.users.updateUser(support.id, { email: 'me@evil.example' }), locked);
  assert.throws(() => h.users.updateUser(support.id, { firstName: 'X' }), locked);
  assert.throws(() => h.users.setRoles(support.id, ['accountant']), locked);
  assert.throws(() => h.users.updatePassword(support.id, 'a-new-password'), locked);
  assert.throws(() => h.users.resetUserPassword(support.id, 'a-new-password'), locked);
  assert.throws(() => h.users.softDelete(support.id), locked);
  assert.throws(() => h.users.hardDelete(support.id), locked);
  assert.deepEqual(supportRow(h.db), support, 'the row is untouched');
  assert.throws(() => h.users.createUser({ email: support.email, password: 'x', roles: ['admin'] }), (e) => e.code === 'EMAIL_ALREADY_EXISTS');
});

test('rule 21 — an existing database marks the support account it already has, by the address it was created with', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, passwordHash TEXT NOT NULL,
      firstName TEXT NOT NULL DEFAULT '', lastName TEXT NOT NULL DEFAULT '', companyName TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '', mustChangePassword INTEGER NOT NULL DEFAULT 0, isActive INTEGER NOT NULL DEFAULT 1,
      lastLoginAt TEXT, emailChangedAt TEXT, createdAt TEXT, updatedAt TEXT, twoFactorSnoozedUntil TEXT);
    CREATE TABLE user_roles (userId INTEGER NOT NULL, role TEXT NOT NULL, PRIMARY KEY (userId, role));
  `);
  db.prepare("INSERT INTO users (email, passwordHash, isActive) VALUES ('owner@x.fr', 'h', 1), (?, 'h', 0)").run(supportTokens.SUPPORT_USER_EMAIL);
  applyAccountSecuritySchema(db);
  applyAccountSecuritySchema(db);
  const flagged = db.prepare('SELECT id, email FROM users WHERE isSupportAccount = 1').all();
  assert.deepEqual(flagged, [{ id: 2, email: supportTokens.SUPPORT_USER_EMAIL }], 'one account, the existing one, idempotent');
});

test('rule 21 — the admin recovery never picks the support account', () => {
  const db = makeDb();
  const users = usersModelModule.buildModel(db);
  db.prepare("INSERT INTO users (email, passwordHash) VALUES ('claire@aulnes.fr', 'h')").run();
  const claire = db.prepare("SELECT id FROM users WHERE email = 'claire@aulnes.fr'").get().id;
  db.prepare("INSERT INTO user_roles (userId, role) VALUES (?, 'admin')").run(claire);
  const before = supportRow(db);
  assert.ok(before.id < claire, 'the support account is the oldest admin row');
  users.resetAdminToDefault();
  assert.equal(db.prepare('SELECT email FROM users WHERE id = ?').get(claire).email, 'admin@guestflow.local');
  assert.deepEqual(supportRow(db), before);
});

test('rule 21 — reset-admin.js on an instance onboarded by create-first-admin restores the customer, not the support', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-reset-admin-'));
  const dbPath = path.join(dir, 'guestflow.db');
  const env = { PATH: process.env.PATH, DB_PATH: dbPath };
  try {
    const out = execFileSync(process.execPath, [path.join(SERVER, 'scripts', 'create-first-admin.js'), '--email', 'claire@aulnes.fr', '--name', 'Claire Martin'],
      { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    assert.equal(JSON.parse(out.trim().split('\n').pop()).removedBootstrap, true, 'the bootstrap admin is gone');
    const read = () => {
      const db = new Database(dbPath, { readonly: true });
      try { return db.prepare('SELECT id, email, isActive, isSupportAccount, passwordHash FROM users ORDER BY id').all(); } finally { db.close(); }
    };
    const support = read().find((u) => u.isSupportAccount === 1);
    execFileSync(process.execPath, [path.join(SERVER, 'scripts', 'reset-admin.js')], { env, stdio: 'ignore' });
    const after = read();
    assert.deepEqual(after.find((u) => u.isSupportAccount === 1), support, 'the support account is untouched');
    const restored = after.find((u) => u.email === 'admin@guestflow.local');
    assert.equal(restored.isSupportAccount, 0);
    assert.ok(!after.some((u) => u.email === 'claire@aulnes.fr'), 'Claire\'s account is the one restored');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 22 — without its own slug the instance accepts no support request and no link', () => {
  const keys = keyPair();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-support-slug-'));
  fs.writeFileSync(path.join(dir, supportTokens.REQUEST_FILE), supportTokens.signRequest({ slug: 'domaine-ombre', requestId: 'r', reason: 'Motif', requestedAt: '' }, keys.privateKey));
  assert.equal(supportTokens.readRequest({ dataDir: dir, publicKey: keys.publicKey, slug: null }), null);
  assert.equal(supportTokens.readRequest({ dataDir: dir, publicKey: keys.publicKey, slug: 'domaine-ombre' }).reason, 'Motif');
  const token = supportTokens.signLink({ slug: 'domaine-ombre', accessId: 1, jti: 'j', now: new Date() }, keys.privateKey);
  assert.throws(() => supportTokens.verifyLink(token, { publicKey: keys.publicKey, slug: null, now: new Date() }), /slug unknown/);
  assert.throws(() => supportTokens.verifyLink(token, { publicKey: keys.publicKey, slug: 'autre', now: new Date() }), /another instance/);
});

test('rule 22 — the slug comes from the licence when the hosting does not set it', () => {
  const keys = keyPair();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-licence-slug-'));
  const write = (payload) => fs.writeFileSync(path.join(dir, 'licence.jws'), signLicence(payload, keys.privateKey));
  const reader = () => createLicenceReader({ dataDir: dir, publicKey: keys.publicKey, managed: true, log: () => {} });
  assert.equal(reader().slug(), null, 'no licence, no slug');
  write({ slug: 'domaine-ombre', state: 'active', expiresAt: new Date(Date.now() + 86400000).toISOString() });
  assert.equal(reader().slug(), 'domaine-ombre');
  write({ slug: 'domaine-ombre', state: 'active', expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(reader().slug(), 'domaine-ombre', 'an expired licence still names its instance');
  fs.writeFileSync(path.join(dir, 'licence.jws'), signLicence({ slug: 'forged', state: 'active', expiresAt: '2999-01-01' }, keyPair().privateKey));
  assert.equal(reader().slug(), null, 'a forged licence names nothing');

  // The controller asks for the slug each time: one learned later counts.
  let slug = null;
  const h = setup({ publicKey: keys.publicKey });
  const ctl = require('../controllers/supportAccessController').createSupportAccessController({
    model: h.supportAccessModel, users: h.users, publicKey: keys.publicKey, slug: () => slug, now: h.now,
  });
  h.supportAccessModel.receiveRequest({ requestId: 'r1', reason: 'Motif', requestedAt: '' });
  const admin = h.addUser('a@x.fr');
  const pendingId = h.supportAccessModel.pending().id;
  ctl.decide(admin, pendingId, { decision: 'accept' });
  const link = () => supportTokens.signLink({ slug: 'domaine-ombre', accessId: pendingId, jti: crypto.randomUUID(), now: h.now() }, keys.privateKey);
  assert.throws(() => ctl.consumeLink(link()), (e) => e.body.error === 'INVALID_LINK');
  slug = 'domaine-ombre';
  assert.equal(ctl.consumeLink(link()).user.isSupport, true);
});
