// specs/control-plane-plans-and-access.md rule 7 — the first administrator of a hosted instance,
// created by the control plane through `scripts/create-first-admin.js`: an admin with a temporary
// password to change, idempotent, and the well-known bootstrap account closed behind it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');
const { createFirstAdmin, splitName } = require('../utils/firstAdmin');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'create-first-admin.js');

function run(dbPath, email, name) {
  const out = execFileSync(process.execPath, [SCRIPT, '--email', email, '--name', name], {
    env: { PATH: process.env.PATH, DB_PATH: dbPath }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out.trim().split('\n').pop());
}

test('rule 7 — the script creates an admin who must change the password, and closes the bootstrap account', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-first-admin-'));
  const dbPath = path.join(dir, 'guestflow.db');
  try {
    const first = run(dbPath, 'claire@aulnes.fr', 'Claire Martin');
    assert.equal(first.created, true);
    assert.equal(first.removedBootstrap, true);
    assert.match(first.temporaryPassword, /^[A-Za-z2-9]{12}$/);
    const again = run(dbPath, 'claire@aulnes.fr', 'Claire Martin');
    assert.deepEqual(again, { created: false, temporaryPassword: null, removedBootstrap: false });
    const db = new Database(dbPath, { readonly: true });
    const users = db.prepare('SELECT u.email, u.firstName, u.lastName, u.mustChangePassword, r.role FROM users u JOIN user_roles r ON r.userId = u.id').all();
    db.close();
    assert.deepEqual(users, [{ email: 'claire@aulnes.fr', firstName: 'Claire', lastName: 'Martin', mustChangePassword: 1, role: 'admin' }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 7 — a bootstrap account someone already used is never removed', () => {
  const calls = [];
  const users = {
    'admin@guestflow.local': { id: 1, lastLoginAt: '2026-09-01 10:00:00', mustChangePassword: 0 },
  };
  const usersModel = {
    findByEmail: (e) => users[e] || null,
    createUser: (u) => { calls.push(u); users[u.email] = { id: 2 }; },
    hardDelete: () => { throw new Error('must not be called'); },
  };
  const r = createFirstAdmin({ usersModel, generatePassword: () => 'Tmp', email: 'a@b.fr', name: 'Anne' });
  assert.deepEqual(r, { created: true, temporaryPassword: 'Tmp', removedBootstrap: false });
  assert.deepEqual(calls[0].roles, ['admin']);
  assert.deepEqual(splitName('  Jean  de la Fontaine '), { firstName: 'Jean', lastName: 'de la Fontaine' });
});
