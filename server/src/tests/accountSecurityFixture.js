// Shared fixture of the hosting-h2 suites (specs/hosting-h2-account-security.md): an in-memory
// database with the users tables and the account-security schema, the real models over it, a clock,
// a mail outbox and fake HTTP objects. Not a test file: each suite imports it.

const Database = require('better-sqlite3');
const crypto = require('crypto');
const usersModelModule = require('../models/usersModel');
const { hashPassword } = require('../utils/passwordHash');
const { applyAccountSecuritySchema } = require('../utils/accountSecuritySchema');
const twoFactorModelModule = require('../models/twoFactorModel');
const passwordResetModelModule = require('../models/passwordResetModel');
const supportAccessModelModule = require('../models/supportAccessModel');
const { createTwoFactorController } = require('../controllers/twoFactorController');
const { createPasswordResetController } = require('../controllers/passwordResetController');
const { createSupportAccessController } = require('../controllers/supportAccessController');

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      firstName TEXT NOT NULL DEFAULT '',
      lastName TEXT NOT NULL DEFAULT '',
      companyName TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      mustChangePassword INTEGER NOT NULL DEFAULT 0,
      isActive INTEGER NOT NULL DEFAULT 1,
      lastLoginAt TEXT,
      emailChangedAt TEXT,
      createdAt TEXT, updatedAt TEXT
    );
    CREATE UNIQUE INDEX uniq_users_email ON users(email);
    CREATE TABLE user_roles (userId INTEGER NOT NULL, role TEXT NOT NULL, PRIMARY KEY (userId, role),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expire TEXT NOT NULL);
  `);
  applyAccountSecuritySchema(db);
  return db;
}

function makeClock(start = '2026-10-08T10:00:00.000Z') {
  let t = new Date(start).getTime();
  const now = () => new Date(t);
  now.set = (iso) => { t = new Date(iso).getTime(); };
  now.advance = (ms) => { t += ms; };
  return now;
}

function makeMailer({ available = true, publicUrl = 'https://domaine-ombre.guestflow.fr' } = {}) {
  const sent = [];
  return {
    sent,
    state: { available, publicUrl },
    available() { return this.state.available; },
    publicUrl() { return this.state.publicUrl; },
    async send(mail) { sent.push(mail); },
  };
}

// A reversible stand-in for AES-GCM: what matters to the tests is that the column never holds the secret.
const fakeCipher = {
  encrypt: (v) => `enc:${Buffer.from(String(v)).toString('base64')}`,
  decrypt: (v) => Buffer.from(String(v).slice(4), 'base64').toString('utf8'),
};

function setup({ mailer = makeMailer(), publicKey = null, readRequest = () => null, companyName = '' } = {}) {
  const db = makeDb();
  const now = makeClock();
  const users = usersModelModule.buildModel(db);
  const twoFactorModel = twoFactorModelModule.buildModel(db, fakeCipher);
  const passwordResetModel = passwordResetModelModule.buildModel(db);
  const supportAccessModel = supportAccessModelModule.buildModel(db);
  const qr = { toDataURL: async (uri) => `data:image/png;base64,${Buffer.from(uri).toString('base64')}` };
  const company = { name: companyName };
  const twoFactor = createTwoFactorController({
    model: twoFactorModel, users, mailer, trustSecret: 'test-trust-secret', now, qr, companyName: () => company.name,
  });
  const passwordReset = createPasswordResetController({ users, model: passwordResetModel, mailer, twoFactorModel, now, log: () => {} });
  const supportAccess = createSupportAccessController({ model: supportAccessModel, users, publicKey, slug: 'domaine-ombre', readRequest, now });

  function addUser(email, { password = 'correct horse battery', roles = ['admin'], firstName = '', lastName = '' } = {}) {
    const id = Number(db.prepare('INSERT INTO users (email, passwordHash, firstName, lastName) VALUES (?, ?, ?, ?)')
      .run(email, hashPassword(password), firstName, lastName).lastInsertRowid);
    roles.forEach((r) => db.prepare('INSERT INTO user_roles (userId, role) VALUES (?, ?)').run(id, r));
    return users.findById(id);
  }

  return { db, now, mailer, company, users, twoFactorModel, passwordResetModel, supportAccessModel, twoFactor, passwordReset, supportAccess, addUser };
}

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    cookies: [],
    redirectedTo: null,
    finishHandlers: [],
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    end() { return this; },
    cookie(name, value, opts) { this.cookies.push({ name, value, opts }); return this; },
    redirect(code, url) { this.statusCode = code; this.redirectedTo = url; return this; },
    on(event, fn) { if (event === 'finish') this.finishHandlers.push(fn); return this; },
    finish() { this.finishHandlers.forEach((fn) => fn()); },
  };
}

function fakeSession(initial = {}) {
  return {
    ...initial,
    destroyed: false,
    regenerated: 0,
    destroy(cb) { this.destroyed = true; Object.keys(this).forEach((k) => { if (!['destroy', 'regenerate', 'destroyed', 'regenerated'].includes(k)) delete this[k]; }); if (cb) cb(); },
    regenerate(cb) { this.regenerated += 1; if (cb) cb(); },
  };
}

// The console's side of rule 14: a throwaway Ed25519 key pair, as the tests of the licence use.
function keyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'), privateKey };
}

// The console's request written next to the licence, read by an instance whose slug is
// `domaine-ombre`, and an administrator to answer it (rules 12-17).
function withSupportRequest({ reason = 'Vérifier la synchronisation Booking', requestId = 'req-1', slug = 'domaine-ombre', keys = keyPair() } = {}) {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const supportTokens = require('../utils/supportAccess');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-support-'));
  const write = (r) => fs.writeFileSync(path.join(dir, supportTokens.REQUEST_FILE), supportTokens.signRequest({ slug, requestedAt: '2026-10-08T09:00:00.000Z', ...r }, keys.privateKey));
  write({ reason, requestId });
  const readRequest = () => supportTokens.readRequest({ dataDir: dir, publicKey: keys.publicKey, slug: 'domaine-ombre' });
  const h = setup({ publicKey: keys.publicKey, readRequest });
  const marie = h.addUser('marie@domaine-ombre.fr', { firstName: 'Marie' });
  return { ...h, keys, dir, write, marie };
}

// A sign-in link the console would mint for `accessId`.
function supportLink(h, accessId, { jti = crypto.randomUUID(), slug = 'domaine-ombre', at = h.now() } = {}) {
  return require('../utils/supportAccess').signLink({ slug, accessId, jti, now: at }, h.keys.privateKey);
}

// Marie accepts the pending request → its id.
function openSupportAccess(h, hours) {
  const { pending } = h.supportAccess.banner(h.marie);
  h.supportAccess.decide(h.marie, pending.id, { decision: 'accept', hours });
  return pending.id;
}

const totp = require('../utils/totp');

const codeAt = (secret, date) => totp.totp(totp.base32Decode(secret), date);

// Turns the authenticator app on for `user`, as « Mon compte » does → { secret, backupCodes }.
async function enableTotp(h, user, password = 'correct horse battery') {
  const started = await h.twoFactor.start(user, { method: 'totp', password });
  const secret = started.secret.replace(/\s/g, '');
  const { backupCodes } = h.twoFactor.confirm(user, { code: codeAt(secret, h.now()) });
  return { secret, backupCodes };
}

module.exports = {
  makeDb, makeClock, makeMailer, fakeCipher, setup, fakeRes, fakeSession, keyPair, codeAt, enableTotp,
  withSupportRequest, supportLink, openSupportAccess,
};
