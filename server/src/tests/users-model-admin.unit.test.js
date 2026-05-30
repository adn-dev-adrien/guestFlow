const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const usersModelFactory = require('../models/usersModel').buildModel;
const { verifyPassword } = require('../utils/passwordHash');

// Admin-side user management: createUser / list / updateUser / setRoles / resetUserPassword /
// softDelete / hardDelete / findActiveAdminCount. Schema mirrors the post-migration shape (no
// `role` column on users — roles live in user_roles).

function freshModel() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL,
      firstName TEXT NOT NULL DEFAULT '',
      lastName TEXT NOT NULL DEFAULT '',
      companyName TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      isActive INTEGER NOT NULL DEFAULT 1,
      mustChangePassword INTEGER NOT NULL DEFAULT 0,
      lastLoginAt TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE user_roles (
      userId INTEGER NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (userId, role),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.pragma('foreign_keys = ON');
  return { model: usersModelFactory(db), db };
}

test('createUser inserts identity + roles + mustChangePassword=1 atomically', () => {
  const { model, db } = freshModel();
  const user = model.createUser({
    email: 'compta@x.fr',
    password: 'TempPwd1234',
    firstName: 'Marie',
    lastName: 'Dupont',
    companyName: 'ACME',
    notes: 'invitée par Adrien',
    roles: ['accountant'],
  });
  assert.deepEqual(user.roles, ['accountant']);
  assert.equal(user.email, 'compta@x.fr');
  assert.equal(user.firstName, 'Marie');
  assert.equal(user.lastName, 'Dupont');
  assert.equal(user.companyName, 'ACME');
  assert.equal(user.notes, 'invitée par Adrien');
  assert.equal(user.mustChangePassword, true);
  assert.equal(user.isActive, true);

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  assert.equal(row.isActive, 1);
  assert.equal(row.firstName, 'Marie');
});

test('createUser hashes the password (never stores plaintext)', () => {
  const { model, db } = freshModel();
  const user = model.createUser({ email: 'a@b.fr', password: 'PlainText1!', roles: ['accountant'] });
  const row = db.prepare('SELECT passwordHash FROM users WHERE id = ?').get(user.id);
  assert.notEqual(row.passwordHash, 'PlainText1!');
  assert.ok(verifyPassword('PlainText1!', row.passwordHash));
});

test('createUser normalizes the email (trim + lowercase)', () => {
  const { model } = freshModel();
  const user = model.createUser({ email: '  Mixed@Case.Fr  ', password: 'Whatever12', roles: ['accountant'] });
  assert.equal(user.email, 'mixed@case.fr');
});

test('createUser supports multiple roles in one shot', () => {
  const { model } = freshModel();
  const user = model.createUser({ email: 'mix@x.fr', password: 'PwdPwdPwd1', roles: ['admin', 'accountant'] });
  assert.deepEqual([...user.roles].sort(), ['accountant', 'admin']);
});

test('createUser rejects empty roles with ROLES_REQUIRED', () => {
  const { model, db } = freshModel();
  assert.throws(() => model.createUser({ email: 'x@y.z', password: 'PwdPwdPwd1', roles: [] }), /ROLES_REQUIRED/);
  // No user persisted (transaction aborts on the empty-roles guard which throws before the insert).
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'x@y.z'").get().n, 0);
});

test('createUser rejects unknown roles', () => {
  const { model } = freshModel();
  assert.throws(() => model.createUser({ email: 'x@y.z', password: 'PwdPwdPwd1', roles: ['superuser'] }), /UNKNOWN_ROLE/);
});

test('createUser on duplicate email → throws EMAIL_ALREADY_EXISTS', () => {
  const { model } = freshModel();
  model.createUser({ email: 'dup@x.fr', password: 'AAAAAAAAAA', roles: ['accountant'] });
  assert.throws(() => model.createUser({ email: 'dup@x.fr', password: 'BBBBBBBBBB', roles: ['accountant'] }),
    /EMAIL_ALREADY_EXISTS/);
});

test('list returns every user (active + inactive), ordered by name, with roles', () => {
  const { model } = freshModel();
  model.createUser({ email: 'a@x.fr', firstName: 'Bob', lastName: 'Zoé',  password: 'AdminPwd123', roles: ['admin'] });
  model.createUser({ email: 'b@x.fr', firstName: 'Ada', lastName: 'Aaron', password: 'CptPwd12345', roles: ['accountant'] });
  const all = model.list();
  assert.equal(all.length, 2);
  // Order: Aaron, then Zoé (lastName ascending COLLATE NOCASE).
  assert.equal(all[0].email, 'b@x.fr');
  assert.equal(all[1].email, 'a@x.fr');
  for (const u of all) assert.equal(u.passwordHash, undefined);
});

test('updateUser updates identity fields without touching roles when roles is omitted', () => {
  const { model } = freshModel();
  const u = model.createUser({ email: 'edit@x.fr', password: 'PwdPwdPwd1', firstName: 'Old', roles: ['accountant'] });
  const updated = model.updateUser(u.id, { firstName: 'New', companyName: 'CoX' });
  assert.equal(updated.firstName, 'New');
  assert.equal(updated.companyName, 'CoX');
  assert.deepEqual(updated.roles, ['accountant'], 'roles preserved');
});

test('updateUser rewrites the roles atomically when supplied', () => {
  const { model } = freshModel();
  const u = model.createUser({ email: 'role@x.fr', password: 'PwdPwdPwd1', roles: ['accountant'] });
  const updated = model.updateUser(u.id, { roles: ['admin', 'accountant'] });
  assert.deepEqual([...updated.roles].sort(), ['accountant', 'admin']);
});

test('updateUser on a missing id returns null', () => {
  const { model } = freshModel();
  assert.equal(model.updateUser(9999, { firstName: 'X' }), null);
});

test('resetUserPassword: re-hashes, re-forces change, returns safe user', () => {
  const { model, db } = freshModel();
  const created = model.createUser({ email: 'cpt@x.fr', password: 'InitialPwd1', roles: ['accountant'] });
  db.prepare('UPDATE users SET mustChangePassword = 0 WHERE id = ?').run(created.id);
  const out = model.resetUserPassword(created.id, 'BrandNewPwd!');
  assert.equal(out.id, created.id);
  assert.equal(out.mustChangePassword, true);
  const row = db.prepare('SELECT passwordHash FROM users WHERE id = ?').get(created.id);
  assert.ok(!verifyPassword('InitialPwd1', row.passwordHash));
  assert.ok(verifyPassword('BrandNewPwd!', row.passwordHash));
});

test('resetUserPassword on unknown id → null', () => {
  const { model } = freshModel();
  assert.equal(model.resetUserPassword(9999, 'whatever12'), null);
});

test('softDelete flips isActive to 0 and preserves the row + roles', () => {
  const { model, db } = freshModel();
  const u = model.createUser({ email: 's@x.fr', password: 'PwdPwdPwd1', roles: ['accountant'] });
  const after = model.softDelete(u.id);
  assert.equal(after.isActive, false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").get(u.id).n, 1, 'row still there');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user_roles WHERE userId = ?").get(u.id).n, 1, 'roles still there');
});

test('hardDelete removes the row + cascades user_roles when the user never logged in', () => {
  const { model, db } = freshModel();
  const u = model.createUser({ email: 'h@x.fr', password: 'PwdPwdPwd1', roles: ['accountant'] });
  assert.equal(model.hardDelete(u.id), true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").get(u.id).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user_roles WHERE userId = ?").get(u.id).n, 0, 'cascaded');
});

test('hardDelete rejects when the user has logged in', () => {
  const { model, db } = freshModel();
  const u = model.createUser({ email: 'h@x.fr', password: 'PwdPwdPwd1', roles: ['accountant'] });
  db.prepare("UPDATE users SET lastLoginAt = datetime('now') WHERE id = ?").run(u.id);
  assert.throws(() => model.hardDelete(u.id), /HARD_DELETE_NOT_ELIGIBLE/);
});

test('hardDelete rejects when the user has already changed their password', () => {
  const { model } = freshModel();
  const u = model.createUser({ email: 'h@x.fr', password: 'PwdPwdPwd1', roles: ['accountant'] });
  model.updatePassword(u.id, 'ChangedPwd1');
  assert.throws(() => model.hardDelete(u.id), /HARD_DELETE_NOT_ELIGIBLE/);
});

test('findActiveAdminCount reflects soft/hard delete + role changes', () => {
  const { model } = freshModel();
  const a = model.createUser({ email: 'a@x.fr', password: 'PwdPwdPwd1', roles: ['admin'] });
  const b = model.createUser({ email: 'b@x.fr', password: 'PwdPwdPwd1', roles: ['admin', 'accountant'] });
  assert.equal(model.findActiveAdminCount(), 2);

  model.softDelete(a.id);
  assert.equal(model.findActiveAdminCount(), 1);

  // Remove admin from b → 0 active admins (the model alone allows it; the controller enforces the
  // last-admin guard one level up).
  model.setRoles(b.id, ['accountant']);
  assert.equal(model.findActiveAdminCount(), 0);
});

test('setRoles is atomic: failure does not leave a half-written row', () => {
  const { model, db } = freshModel();
  const u = model.createUser({ email: 'tx@x.fr', password: 'PwdPwdPwd1', roles: ['accountant'] });
  assert.throws(() => model.setRoles(u.id, ['admin', 'NOPE']), /UNKNOWN_ROLE/);
  // The DELETE-then-INSERT transaction must roll back: previous roles untouched.
  const stored = db.prepare("SELECT role FROM user_roles WHERE userId = ?").all(u.id).map((r) => r.role);
  assert.deepEqual(stored, ['accountant']);
});
