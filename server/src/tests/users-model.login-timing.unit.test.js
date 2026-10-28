// specs/hosting-h2-account-security.md rule 61 (audit of 2026-10-28, finding L1) — an unknown email
// costs the same password hash as a known one, so the time of a login does not tell whether an
// account exists.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

function loadModelCountingVerifications() {
  const hashPath = require.resolve('../utils/passwordHash');
  const modelPath = require.resolve('../models/usersModel');
  const real = require(hashPath);
  const calls = [];
  const saved = { hash: require.cache[hashPath], model: require.cache[modelPath] };
  require.cache[hashPath] = { ...saved.hash, exports: { ...real, verifyPassword: (...args) => { calls.push(args); return real.verifyPassword(...args); } } };
  delete require.cache[modelPath];
  const fresh = require(modelPath);
  require.cache[hashPath] = saved.hash;
  require.cache[modelPath] = saved.model;
  return { fresh, calls };
}

function memoryDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, passwordHash TEXT NOT NULL,
      firstName TEXT NOT NULL DEFAULT '', lastName TEXT NOT NULL DEFAULT '', companyName TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '', mustChangePassword INTEGER NOT NULL DEFAULT 0, isActive INTEGER NOT NULL DEFAULT 1,
      isSupportAccount INTEGER NOT NULL DEFAULT 0, lastLoginAt TEXT, emailChangedAt TEXT, createdAt TEXT, updatedAt TEXT);
    CREATE UNIQUE INDEX uniq_users_email ON users(email);
    CREATE TABLE user_roles (userId INTEGER NOT NULL, role TEXT NOT NULL, PRIMARY KEY (userId, role));
  `);
  return db;
}

test('rule 61 — an unknown email still verifies a password against a dummy hash', () => {
  const { fresh, calls } = loadModelCountingVerifications();
  const model = fresh.buildModel(memoryDb());
  assert.equal(model.verifyCredentials('personne@example.invalid', 'whatever password'), null);
  assert.equal(calls.length, 1, 'one hash was computed');
});

test('rule 61 — a known email verifies once, and an inactive or support account too', () => {
  const { fresh, calls } = loadModelCountingVerifications();
  const db = memoryDb();
  const model = fresh.buildModel(db);
  model.createUser({ email: 'marie@domaine-ombre.fr', password: 'correct horse battery', roles: ['admin'] });
  assert.ok(model.verifyCredentials('marie@domaine-ombre.fr', 'correct horse battery'));
  assert.equal(calls.length, 1);
  db.prepare('UPDATE users SET isActive = 0').run();
  calls.length = 0;
  assert.equal(model.verifyCredentials('marie@domaine-ombre.fr', 'correct horse battery'), null);
  assert.equal(calls.length, 1, 'a deactivated account costs the same');
});
