#!/usr/bin/env node
/**
 * Admin account recovery — run on the server when the admin password is lost.
 *
 *   cd server && npm run reset-admin
 *
 * Restores the default admin account to the documented default credentials with a forced password
 * change on next login (same as a first launch), and clears existing sessions so any old session is
 * invalidated. Requires filesystem access to the server (e.g. SSH on the Pi).
 */

const db = require('../src/database');
const usersModel = require('../src/models/usersModel');
const { DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD } = require('../src/constants/authDefaults');

try {
  const email = usersModel.resetAdminToDefault();
  // Invalidate any existing sessions (best effort; table is created by the session store).
  try { db.prepare('DELETE FROM sessions').run(); } catch { /* sessions table may not exist yet */ }

  console.log('✅ Admin account restored.');
  console.log(`   Email    : ${email}`);
  console.log(`   Password : ${DEFAULT_ADMIN_PASSWORD}`);
  console.log('   You will be required to set a new password on next login.');
  process.exit(0);
} catch (err) {
  console.error('❌ Failed to reset the admin account:', err.message);
  process.exit(1);
}
