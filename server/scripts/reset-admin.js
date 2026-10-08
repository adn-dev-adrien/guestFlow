#!/usr/bin/env node
/**
 * Admin account recovery — run on the server when the admin password is lost.
 *
 *   cd server && npm run reset-admin
 *
 * Restores the default admin account to the documented default credentials with a forced password
 * change on next login (same as a first launch), and clears existing sessions so any old session is
 * invalidated. Requires filesystem access to the server (e.g. SSH on the Pi).
 *
 *   cd server && npm run reset-admin -- --disable-2fa
 *
 * Also turns off the second step of that admin account (a lost phone and no other administrator,
 * specs/hosting-h2-account-security.md §3), recorded in the account's history.
 */

const db = require('../src/database');
const usersModel = require('../src/models/usersModel');
const { DEFAULT_ADMIN_PASSWORD } = require('../src/constants/authDefaults');
const twoFactorModel = require('../src/models/twoFactorModel').default;

const disableTwoFactor = process.argv.includes('--disable-2fa');

try {
  const email = usersModel.resetAdminToDefault();
  if (disableTwoFactor) {
    const admin = usersModel.findByEmail(email);
    twoFactorModel.disable(admin.id);
    twoFactorModel.addEvent(admin.id, 'disabled_by_script', 'reset-admin.js', new Date().toISOString());
  }
  // Invalidate any existing sessions (best effort; table is created by the session store).
  try { db.prepare('DELETE FROM sessions').run(); } catch { /* sessions table may not exist yet */ }

  console.log('✅ Admin account restored.');
  console.log(`   Email    : ${email}`);
  console.log(`   Password : ${DEFAULT_ADMIN_PASSWORD}`);
  console.log('   You will be required to set a new password on next login.');
  if (disableTwoFactor) console.log('   Second step turned off (recorded in the account history).');
  process.exit(0);
} catch (err) {
  console.error('❌ Failed to reset the admin account:', err.message);
  process.exit(1);
}
