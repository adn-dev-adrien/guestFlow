const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const usersModelFactory = require('../models/usersModel').create;
const { verifyPassword } = require('../utils/passwordHash');

// Admin-side user management: list / createUser / resetUserPassword. Mirrors the production schema
// closely enough for the model to exercise its SQL.
function freshModel() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      isActive INTEGER NOT NULL DEFAULT 1,
      mustChangePassword INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    );
  `);
  return { model: usersModelFactory(db), db };
}

test('createUser inserts an accountant with mustChangePassword=1 and isActive=1', () => {
  const { model, db } = freshModel();
  const user = model.createUser({ email: 'compta@x.fr', password: 'TempPwd1234', role: 'accountant' });
  assert.equal(user.role, 'accountant');
  assert.equal(user.email, 'compta@x.fr');
  assert.equal(user.mustChangePassword, true);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  assert.equal(row.isActive, 1);
  assert.equal(row.role, 'accountant');
});

test('createUser hashes the password (never stores plaintext)', () => {
  const { model, db } = freshModel();
  const user = model.createUser({ email: 'a@b.fr', password: 'PlainText1!', role: 'accountant' });
  const row = db.prepare('SELECT passwordHash FROM users WHERE id = ?').get(user.id);
  assert.notEqual(row.passwordHash, 'PlainText1!');
  assert.ok(verifyPassword('PlainText1!', row.passwordHash));
});

test('createUser normalizes the email (trim + lowercase)', () => {
  const { model } = freshModel();
  const user = model.createUser({ email: '  Mixed@Case.Fr  ', password: 'Whatever12', role: 'accountant' });
  assert.equal(user.email, 'mixed@case.fr');
});

test('createUser on duplicate email → throws UNIQUE constraint (controller maps to 409)', () => {
  const { model } = freshModel();
  model.createUser({ email: 'dup@x.fr', password: 'AAAAAAAAAA', role: 'accountant' });
  assert.throws(() => model.createUser({ email: 'dup@x.fr', password: 'BBBBBBBBBB', role: 'accountant' }),
    /UNIQUE/);
});

test('list returns every user in safe shape (no hash leaked)', () => {
  const { model } = freshModel();
  model.createUser({ email: 'admin@x.fr', password: 'AdminPwd123', role: 'admin' });
  model.createUser({ email: 'cpt@x.fr',   password: 'CptPwd12345', role: 'accountant' });
  const all = model.list();
  assert.equal(all.length, 2);
  for (const u of all) {
    assert.ok(u.email);
    assert.ok(u.role);
    assert.equal(u.passwordHash, undefined);
  }
});

test('resetUserPassword: re-hashes, re-forces change, returns safe user', () => {
  const { model, db } = freshModel();
  const created = model.createUser({ email: 'cpt@x.fr', password: 'InitialPwd1', role: 'accountant' });
  // Simulate that the user already changed their password once (mustChangePassword=0).
  db.prepare('UPDATE users SET mustChangePassword = 0 WHERE id = ?').run(created.id);
  const out = model.resetUserPassword(created.id, 'BrandNewPwd!');
  assert.equal(out.id, created.id);
  assert.equal(out.mustChangePassword, true);
  // Old password no longer works; new one does.
  const row = db.prepare('SELECT passwordHash FROM users WHERE id = ?').get(created.id);
  assert.ok(!verifyPassword('InitialPwd1', row.passwordHash));
  assert.ok(verifyPassword('BrandNewPwd!', row.passwordHash));
});

test('resetUserPassword on unknown id → null', () => {
  const { model } = freshModel();
  assert.equal(model.resetUserPassword(9999, 'whatever12'), null);
});
