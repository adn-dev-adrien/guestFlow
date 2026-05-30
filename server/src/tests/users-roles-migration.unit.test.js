const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

// Migration coverage for specs/admin-account-management.md §5: the single-role users.role TEXT
// column is replaced by a join table `user_roles(userId, role)`, identity fields are added, and
// `app_settings` gains the SMTP block. We don't run the production database.js (it boots the whole
// app); instead we replay the exact ALTER / CREATE / INSERT statements the migration emits and
// assert end-state shape. Idempotency is checked by replaying the migration a second time.

function applyMigration(db) {
  const usersCols = () => db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  const tryAddUsersCol = (col, sql) => {
    if (!usersCols().includes(col)) db.exec(sql);
  };
  tryAddUsersCol('firstName',   "ALTER TABLE users ADD COLUMN firstName TEXT NOT NULL DEFAULT ''");
  tryAddUsersCol('lastName',    "ALTER TABLE users ADD COLUMN lastName TEXT NOT NULL DEFAULT ''");
  tryAddUsersCol('companyName', "ALTER TABLE users ADD COLUMN companyName TEXT NOT NULL DEFAULT ''");
  tryAddUsersCol('notes',       "ALTER TABLE users ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
  tryAddUsersCol('lastLoginAt', 'ALTER TABLE users ADD COLUMN lastLoginAt TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_roles (
      userId INTEGER NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (userId, role),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  const stillHasRole = () => db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'role');
  const joinEmpty = () => db.prepare('SELECT COUNT(*) AS n FROM user_roles').get().n === 0;

  if (stillHasRole() && joinEmpty()) {
    db.exec(`
      INSERT INTO user_roles (userId, role)
      SELECT id, role FROM users WHERE role IS NOT NULL AND trim(role) <> ''
    `);
  }
  if (stillHasRole()) {
    db.exec('ALTER TABLE users DROP COLUMN role');
  }
}

function createPreSpecDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      mustChangePassword INTEGER NOT NULL DEFAULT 0,
      isActive INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    );
  `);
  db.prepare("INSERT INTO users (email, passwordHash, role) VALUES ('admin@guestflow.local', 'hash', 'admin')").run();
  db.prepare("INSERT INTO users (email, passwordHash, role) VALUES ('compta@example.org', 'hash', 'accountant')").run();
  return db;
}

test('migration drops users.role, populates user_roles preserving each existing role', () => {
  const db = createPreSpecDb();
  applyMigration(db);

  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  assert.equal(cols.includes('role'), false, 'role column dropped');
  for (const c of ['firstName', 'lastName', 'companyName', 'notes', 'lastLoginAt']) {
    assert.equal(cols.includes(c), true, `${c} column added`);
  }

  const rows = db.prepare('SELECT u.email, r.role FROM users u JOIN user_roles r ON r.userId = u.id ORDER BY u.email, r.role').all();
  assert.deepEqual(rows, [
    { email: 'admin@guestflow.local', role: 'admin' },
    { email: 'compta@example.org',    role: 'accountant' },
  ]);

  // Identity columns default to '' (not null).
  const u = db.prepare("SELECT firstName, lastName, companyName, notes, lastLoginAt FROM users WHERE email = 'admin@guestflow.local'").get();
  assert.equal(u.firstName, '');
  assert.equal(u.lastName, '');
  assert.equal(u.companyName, '');
  assert.equal(u.notes, '');
  assert.equal(u.lastLoginAt, null);
});

test('migration is idempotent: a second run is a no-op (schema + data unchanged)', () => {
  const db = createPreSpecDb();
  applyMigration(db);
  const snapshot1 = {
    cols: db.prepare('PRAGMA table_info(users)').all(),
    roles: db.prepare('SELECT * FROM user_roles ORDER BY userId, role').all(),
    users: db.prepare('SELECT id, email, isActive FROM users ORDER BY id').all(),
  };
  applyMigration(db);
  const snapshot2 = {
    cols: db.prepare('PRAGMA table_info(users)').all(),
    roles: db.prepare('SELECT * FROM user_roles ORDER BY userId, role').all(),
    users: db.prepare('SELECT id, email, isActive FROM users ORDER BY id').all(),
  };
  assert.deepEqual(snapshot1, snapshot2);
});

test('migration on a fresh-shape DB (no `role` column already) leaves the join table alone if empty', () => {
  // Simulates the situation where a fresh install never had the legacy `role` column. The seed in
  // database.js inserts directly into user_roles in that case; the migration block must not wipe it.
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
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE user_roles (userId INTEGER NOT NULL, role TEXT NOT NULL, PRIMARY KEY (userId, role));
  `);
  db.prepare("INSERT INTO users (email, passwordHash) VALUES ('admin@guestflow.local', 'hash')").run();
  db.prepare("INSERT INTO user_roles (userId, role) VALUES (1, 'admin')").run();

  applyMigration(db);

  const rows = db.prepare('SELECT userId, role FROM user_roles').all();
  assert.deepEqual(rows, [{ userId: 1, role: 'admin' }]);
});

test('hardDelete cascade: ON DELETE CASCADE removes user_roles rows when a user is deleted', () => {
  const db = createPreSpecDb();
  applyMigration(db);
  // SQLite needs the foreign-key pragma ON to honor cascades.
  db.pragma('foreign_keys = ON');

  db.prepare("DELETE FROM users WHERE email = 'compta@example.org'").run();

  const leftovers = db.prepare("SELECT * FROM user_roles WHERE userId NOT IN (SELECT id FROM users)").all();
  assert.deepEqual(leftovers, []);
});
