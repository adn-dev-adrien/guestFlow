const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const usersModel = require('../models/usersModel');
const { hashPassword } = require('../utils/passwordHash');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      mustChangePassword INTEGER NOT NULL DEFAULT 0,
      isActive INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT, updatedAt TEXT
    );
    CREATE UNIQUE INDEX uniq_users_email ON users(email);
  `);
  return db;
}

function seedUser(db, { email = 'admin@guestflow.local', password = 'ChangeMe!2026', mustChange = 1, active = 1 } = {}) {
  db.prepare('INSERT INTO users (email, passwordHash, role, mustChangePassword, isActive) VALUES (?, ?, ?, ?, ?)')
    .run(email, hashPassword(password), 'admin', mustChange, active);
}

test('verifyCredentials returns a safe user on correct password, null otherwise', () => {
  const db = makeDb();
  seedUser(db);
  const model = usersModel.create(db);

  const ok = model.verifyCredentials('admin@guestflow.local', 'ChangeMe!2026');
  assert.ok(ok);
  assert.deepEqual(Object.keys(ok).sort(), ['email', 'id', 'mustChangePassword', 'role'].sort());
  assert.equal(ok.mustChangePassword, true);
  assert.equal(ok.passwordHash, undefined, 'safe user never exposes the hash');

  assert.equal(model.verifyCredentials('admin@guestflow.local', 'wrong'), null);
  assert.equal(model.verifyCredentials('unknown@x.com', 'whatever'), null);
});

test('email lookup is case-insensitive', () => {
  const db = makeDb();
  seedUser(db);
  const model = usersModel.create(db);
  assert.ok(model.verifyCredentials('ADMIN@GuestFlow.Local', 'ChangeMe!2026'));
});

test('inactive users cannot authenticate', () => {
  const db = makeDb();
  seedUser(db, { active: 0 });
  const model = usersModel.create(db);
  assert.equal(model.verifyCredentials('admin@guestflow.local', 'ChangeMe!2026'), null);
});

test('updatePassword changes the password and clears mustChangePassword', () => {
  const db = makeDb();
  seedUser(db);
  const model = usersModel.create(db);
  const id = model.findByEmail('admin@guestflow.local').id;

  model.updatePassword(id, 'a-brand-new-password');
  assert.equal(model.verifyCredentials('admin@guestflow.local', 'ChangeMe!2026'), null, 'old password rejected');
  const user = model.verifyCredentials('admin@guestflow.local', 'a-brand-new-password');
  assert.ok(user);
  assert.equal(user.mustChangePassword, false, 'flag cleared');
});

test('unique email constraint blocks duplicates', () => {
  const db = makeDb();
  seedUser(db);
  assert.throws(() => seedUser(db));
});
