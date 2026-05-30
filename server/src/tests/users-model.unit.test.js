const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const usersModel = require('../models/usersModel');
const { hashPassword } = require('../utils/passwordHash');

// Core authentication path (verify / find / updatePassword / resetAdminToDefault). Admin-side user
// management is exercised in users-model-admin.unit.test.js.

function makeDb() {
  const db = new Database(':memory:');
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
      createdAt TEXT, updatedAt TEXT
    );
    CREATE UNIQUE INDEX uniq_users_email ON users(email);
    CREATE TABLE user_roles (
      userId INTEGER NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (userId, role),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.pragma('foreign_keys = ON');
  return db;
}

function seedUser(db, { email = 'admin@guestflow.local', password = 'ChangeMe!2026', mustChange = 1, active = 1, roles = ['admin'] } = {}) {
  db.prepare("INSERT INTO users (email, passwordHash, mustChangePassword, isActive) VALUES (?, ?, ?, ?)")
    .run(email, hashPassword(password), mustChange, active);
  const id = db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
  for (const role of roles) {
    db.prepare('INSERT INTO user_roles (userId, role) VALUES (?, ?)').run(id, role);
  }
}

test('verifyCredentials returns a safe user (with roles array) on correct password, null otherwise', () => {
  const db = makeDb();
  seedUser(db);
  const model = usersModel.buildModel(db);

  const ok = model.verifyCredentials('admin@guestflow.local', 'ChangeMe!2026');
  assert.ok(ok);
  assert.deepEqual(ok.roles, ['admin']);
  assert.equal(ok.mustChangePassword, true);
  assert.equal(ok.passwordHash, undefined, 'safe user never exposes the hash');

  assert.equal(model.verifyCredentials('admin@guestflow.local', 'wrong'), null);
  assert.equal(model.verifyCredentials('unknown@x.com', 'whatever'), null);
});

test('safe user shape carries the identity fields with defaults', () => {
  const db = makeDb();
  seedUser(db);
  const model = usersModel.buildModel(db);
  const u = model.verifyCredentials('admin@guestflow.local', 'ChangeMe!2026');
  assert.equal(u.firstName, '');
  assert.equal(u.lastName, '');
  assert.equal(u.companyName, '');
  assert.equal(u.notes, '');
  assert.equal(u.lastLoginAt, null);
  assert.equal(u.isActive, true);
});

test('email lookup is case-insensitive', () => {
  const db = makeDb();
  seedUser(db);
  const model = usersModel.buildModel(db);
  assert.ok(model.verifyCredentials('ADMIN@GuestFlow.Local', 'ChangeMe!2026'));
});

test('inactive users cannot authenticate', () => {
  const db = makeDb();
  seedUser(db, { active: 0 });
  const model = usersModel.buildModel(db);
  assert.equal(model.verifyCredentials('admin@guestflow.local', 'ChangeMe!2026'), null);
});

test('updatePassword changes the password and clears mustChangePassword', () => {
  const db = makeDb();
  seedUser(db);
  const model = usersModel.buildModel(db);
  const id = model.findByEmail('admin@guestflow.local').id;

  model.updatePassword(id, 'a-brand-new-password');
  assert.equal(model.verifyCredentials('admin@guestflow.local', 'ChangeMe!2026'), null, 'old password rejected');
  const user = model.verifyCredentials('admin@guestflow.local', 'a-brand-new-password');
  assert.ok(user);
  assert.equal(user.mustChangePassword, false, 'flag cleared');
});

test('touchLastLogin updates the column to a non-null timestamp', () => {
  const db = makeDb();
  seedUser(db);
  const model = usersModel.buildModel(db);
  const id = model.findByEmail('admin@guestflow.local').id;
  assert.equal(model.findById(id).lastLoginAt, null);
  model.touchLastLogin(id);
  const after = model.findById(id);
  assert.ok(after.lastLoginAt && /^\d{4}-\d{2}-\d{2}/.test(after.lastLoginAt));
});

test('unique email constraint blocks duplicates (raw insert path)', () => {
  const db = makeDb();
  seedUser(db);
  assert.throws(() => seedUser(db));
});

test('resetAdminToDefault restores default credentials + forced change on an altered admin', () => {
  const db = makeDb();
  seedUser(db, { password: 'SomeOtherPassword123', mustChange: 0, active: 0 });
  const model = usersModel.buildModel(db);

  const email = model.resetAdminToDefault();
  assert.equal(email, 'admin@guestflow.local');

  const user = model.verifyCredentials('admin@guestflow.local', 'ChangeMe!2026');
  assert.ok(user, 'default password restored + account active');
  assert.equal(user.mustChangePassword, true);
  assert.deepEqual(user.roles, ['admin']);
  assert.equal(model.verifyCredentials('admin@guestflow.local', 'SomeOtherPassword123'), null, 'old password no longer valid');
});

test('resetAdminToDefault recreates the admin (with the admin role) when the row is missing', () => {
  const db = makeDb();
  const model = usersModel.buildModel(db);
  model.resetAdminToDefault();
  const user = model.verifyCredentials('admin@guestflow.local', 'ChangeMe!2026');
  assert.ok(user);
  assert.equal(user.mustChangePassword, true);
  assert.deepEqual(user.roles, ['admin']);
});
