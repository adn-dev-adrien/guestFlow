// specs/self-update-and-releases.md rule 39 (reading of 2026-11-11) — the dormant support account of
// hosting-h2-account-security.md rule 21 cannot be reactivated, re-keyed or unflagged by any writer, including
// the previous release's user screens after a rollback (shadow trial of 4.0.0: it was listed and reactivable in v3.21.0).
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');

const support = () => db.prepare('SELECT * FROM users WHERE isSupportAccount = 1').get();
const refused = (sql, ...params) => assert.throws(() => db.prepare(sql).run(...params), /SUPPORT_ACCOUNT_LOCKED/);

test('rule 39 — the seeded support account is inactive and every identity or credential write is refused', () => {
  const row = support();
  assert.ok(row);
  assert.equal(row.isActive, 0);
  // The writes v3.21.0's user screens issue: reactivate, reset the password (which also activates), unflag.
  refused('UPDATE users SET isActive = 1 WHERE id = ?', row.id);
  refused("UPDATE users SET passwordHash = 'scrypt:AA==:AA==', mustChangePassword = 1, isActive = 1 WHERE id = ?", row.id);
  refused('UPDATE users SET isSupportAccount = 0 WHERE id = ?', row.id);
  assert.deepEqual(support(), row, 'nothing moved');
});

test('rule 39 — the writes 4.0.0 itself makes on the row stay possible, and ordinary users are untouched', () => {
  const row = support();
  db.prepare("UPDATE users SET lastLoginAt = datetime('now') WHERE id = ?").run(row.id);
  db.prepare('UPDATE users SET isActive = 0, isSupportAccount = 1 WHERE id = ?').run(row.id);
  const id = Number(db.prepare("INSERT INTO users (email, passwordHash, firstName, lastName) VALUES ('ordinary@example.test', 'x', 'A', 'B')").run().lastInsertRowid);
  db.prepare("UPDATE users SET isActive = 0, email = 'other@example.test' WHERE id = ?").run(id);
  assert.equal(db.prepare('SELECT email FROM users WHERE id = ?').get(id).email, 'other@example.test');
});
