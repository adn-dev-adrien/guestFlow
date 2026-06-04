#!/usr/bin/env node
/**
 * seed-e2e.js — deterministic admin bootstrap for the Playwright suite
 * (specs/e2e-playwright-smoke-suite.md §3.1 rule 5, §4.1).
 *
 *   E2E_ADMIN_EMAIL=… E2E_ADMIN_PASSWORD=… DB_PATH=/tmp/x.db node server/scripts/seed-e2e.js
 *
 * Inserts an admin user with `mustChangePassword=0` so the E2E suite can log in directly
 * via the API without first navigating the change-password flow. The `force-password-change`
 * spec uses the standard `reset-admin.js` script against the default admin instead — this
 * seed leaves the default admin path intact.
 *
 * Idempotent: re-running on a DB that already has the e2e admin is a no-op (logs + exit 0).
 * Safe to call from Playwright's globalSetup unconditionally.
 */

const DEFAULT_EMAIL = process.env.E2E_ADMIN_EMAIL || 'e2e@guestflow.test';
const DEFAULT_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'e2e-secret-1234';

const db = require('../src/database');
const usersModel = require('../src/models/usersModel');
const { hashPassword } = require('../src/utils/passwordHash');

function run() {
  // Look up by email — if present, no-op.
  const existing = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(DEFAULT_EMAIL);
  if (existing) {
    console.log(`[seed-e2e] admin ${DEFAULT_EMAIL} already exists (id=${existing.id}) — no-op.`);
    return 0;
  }
  // Create + clear the mustChangePassword flag in one raw UPDATE (createUser hardcodes it to 1).
  const created = usersModel.createUser({
    email: DEFAULT_EMAIL,
    password: DEFAULT_PASSWORD,
    firstName: 'E2E',
    lastName: 'Admin',
    roles: ['admin'],
  });
  // Replay the password hash + drop the must-change flag — the same operation `setPassword`
  // does at the end of the change-password flow. We can't call setPassword(id, currentPw, newPw)
  // here because it requires the current password; a direct UPDATE is equivalent and avoids the
  // extra hash + check round-trip.
  const hash = hashPassword(DEFAULT_PASSWORD);
  db.prepare(
    "UPDATE users SET passwordHash = ?, mustChangePassword = 0, updatedAt = datetime('now') WHERE id = ?",
  ).run(hash, created.id);

  console.log(`[seed-e2e] admin created: id=${created.id}, email=${DEFAULT_EMAIL}, password set, mustChangePassword=0.`);
  return 0;
}

try {
  process.exit(run());
} catch (err) {
  console.error('[seed-e2e] failed:', err && err.message ? err.message : err);
  process.exit(1);
}
