/**
 * The first administrator of a hosted instance, created by the control plane at onboarding
 * (specs/control-plane-plans-and-access.md rule 7). Run through `scripts/create-first-admin.js`.
 *
 * - The account is an admin with a temporary password and `mustChangePassword`, exactly like an
 *   account an admin creates from the Users page.
 * - It is idempotent: an email that already exists is left untouched (`created: false`).
 * - The seeded bootstrap account (`admin@guestflow.local` with its documented password) is removed
 *   once the real admin exists, as long as nobody ever logged in with it: on a hosted instance a
 *   well-known password must not stay open.
 */

const { ADMIN } = require('../constants/roles');
const { DEFAULT_ADMIN_EMAIL } = require('../constants/authDefaults');

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
}

function createFirstAdmin({ usersModel, generatePassword, email, name }) {
  if (usersModel.findByEmail(email)) return { created: false, temporaryPassword: null, removedBootstrap: false };
  const temporaryPassword = generatePassword();
  usersModel.createUser({ email, password: temporaryPassword, ...splitName(name), roles: [ADMIN] });

  let removedBootstrap = false;
  const seed = usersModel.findByEmail(DEFAULT_ADMIN_EMAIL);
  if (seed && seed.lastLoginAt == null && Number(seed.mustChangePassword) === 1) {
    usersModel.hardDelete(seed.id);
    removedBootstrap = true;
  }
  return { created: true, temporaryPassword, removedBootstrap };
}

module.exports = { createFirstAdmin, splitName };
