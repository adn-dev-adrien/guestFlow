#!/usr/bin/env node
/**
 * seed-e2e.js — deterministic user bootstrap for the Playwright suite
 * (specs/e2e-playwright-smoke-suite.md §3.1 rule 5, §4.1).
 *
 *   E2E_ADMIN_EMAIL=… E2E_ADMIN_PASSWORD=… DB_PATH=/tmp/x.db node server/scripts/seed-e2e.js
 *
 * Inserts two users with `mustChangePassword=0` so the E2E suite can log in directly via the API
 * without first navigating the change-password flow:
 *   - the **admin** every spec inherits through `e2e/.auth/admin.json`;
 *   - a **reception** account (specs/reception-role-checkin-only.md,
 *     specs/reception-sas-today-only.md) for the specs that assert the « Accueil » confinement and
 *     the day-window SAS locks — they opt in via their own storageState.
 * The `force-password-change` spec uses the standard `reset-admin.js` script against the default
 * admin instead — this seed leaves the default admin path intact.
 *
 * Idempotent: re-running on a DB that already has these users is a no-op (logs + exit 0).
 * Safe to call from Playwright's globalSetup unconditionally.
 */

const DEFAULT_EMAIL = process.env.E2E_ADMIN_EMAIL || 'e2e@guestflow.test';
const DEFAULT_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'e2e-secret-1234';
const RECEPTION_EMAIL = process.env.E2E_RECEPTION_EMAIL || 'e2e-reception@guestflow.test';
const RECEPTION_PASSWORD = process.env.E2E_RECEPTION_PASSWORD || 'e2e-reception-1234';

const db = require('../src/database');
const usersModel = require('../src/models/usersModel');
const { hashPassword } = require('../src/utils/passwordHash');

// Create the user if missing, then replay the password hash + drop the must-change flag — the same
// operation `setPassword` does at the end of the change-password flow. We can't call
// setPassword(id, currentPw, newPw) here because it requires the current password; a direct UPDATE
// is equivalent and avoids the extra hash + check round-trip.
function seedUser({ email, password, firstName, lastName, roles }) {
  const existing = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email);
  if (existing) {
    console.log(`[seed-e2e] ${roles.join('+')} ${email} already exists (id=${existing.id}) — no-op.`);
    return existing.id;
  }
  const created = usersModel.createUser({ email, password, firstName, lastName, roles });
  db.prepare(
    "UPDATE users SET passwordHash = ?, mustChangePassword = 0, updatedAt = datetime('now') WHERE id = ?",
  ).run(hashPassword(password), created.id);
  console.log(`[seed-e2e] ${roles.join('+')} created: id=${created.id}, email=${email}, password set, mustChangePassword=0.`);
  return created.id;
}

function run() {
  seedUser({
    email: DEFAULT_EMAIL, password: DEFAULT_PASSWORD, firstName: 'E2E', lastName: 'Admin', roles: ['admin'],
  });
  seedUser({
    email: RECEPTION_EMAIL, password: RECEPTION_PASSWORD, firstName: 'E2E', lastName: 'Accueil', roles: ['reception'],
  });
  return 0;
}

try {
  process.exit(run());
} catch (err) {
  console.error('[seed-e2e] failed:', err && err.message ? err.message : err);
  process.exit(1);
}
