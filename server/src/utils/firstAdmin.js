/**
 * The first administrator of a hosted instance, created by the control plane at onboarding
 * (specs/control-plane-plans-and-access.md rule 7). Run through `scripts/create-first-admin.js`.
 *
 * - The account is an admin with a temporary password and `mustChangePassword`, exactly like an
 *   account an admin creates from the Users page.
 * - It is idempotent: an email that already exists is left untouched (`created: false`), unless the
 *   console asks for a new provisional password (`reissue`, specs/hosting-h1-fleet-runtime.md
 *   rule 24): `unused` gives one to an account nobody ever signed in to (an invitation that never
 *   arrived), `always` to any account (« Réinitialiser l'accès »), whose second step is also turned
 *   off and recorded in the account's history.
 * - The seeded bootstrap account (`admin@guestflow.local` with its documented password) is removed
 *   once the real admin exists, as long as nobody ever logged in with it: on a hosted instance a
 *   well-known password must not stay open.
 * - `seedEstablishment` fills the establishment with what the console already knows (rule 25), one
 *   empty field at a time: what the customer typed is never overwritten.
 */

const { ADMIN } = require('../constants/roles');
const { DEFAULT_ADMIN_EMAIL } = require('../constants/authDefaults');

const REISSUE = ['never', 'unused', 'always'];

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
}

const neverUsed = (user) => user.lastLoginAt == null && Boolean(user.mustChangePassword);

function reissueFor(user, { usersModel, twoFactorModel, generatePassword, reissue, now }) {
  if (reissue === 'never') return { created: false, temporaryPassword: null, removedBootstrap: false };
  const used = !neverUsed(user);
  if (reissue === 'unused' && used) return { created: false, temporaryPassword: null, removedBootstrap: false, reissued: false, used };
  const temporaryPassword = generatePassword();
  usersModel.resetUserPassword(user.id, temporaryPassword);
  let secondStepOff = false;
  if (reissue === 'always' && twoFactorModel && twoFactorModel.isEnabled(user.id)) {
    twoFactorModel.disable(user.id);
    twoFactorModel.addEvent(user.id, 'disabled_by_script', 'console', now().toISOString());
    secondStepOff = true;
  }
  return { created: false, temporaryPassword, removedBootstrap: false, reissued: true, used, secondStepOff };
}

function createFirstAdmin({
  usersModel, twoFactorModel = null, generatePassword, email, name, companyName = '', reissue = 'never', now = () => new Date(),
}) {
  if (!REISSUE.includes(reissue)) throw new Error(`reissue: ${reissue}`);
  const existing = usersModel.findByEmail(email);
  if (existing) return reissueFor(existing, { usersModel, twoFactorModel, generatePassword, reissue, now });
  const temporaryPassword = generatePassword();
  usersModel.createUser({ email, password: temporaryPassword, ...splitName(name), companyName: String(companyName || ''), roles: [ADMIN] });

  let removedBootstrap = false;
  const seed = usersModel.findByEmail(DEFAULT_ADMIN_EMAIL);
  if (seed && seed.lastLoginAt == null && Number(seed.mustChangePassword) === 1) {
    usersModel.hardDelete(seed.id);
    removedBootstrap = true;
  }
  return { created: true, temporaryPassword, removedBootstrap };
}

// The establishment fields the console sends, and the settings column each one fills.
const ESTABLISHMENT_COLUMNS = { name: 'companyName', email: 'companyEmail', address: 'companyAddress', phone: 'companyPhone', tva: 'companyTva' };

/** → the columns written (those that were empty). */
function seedEstablishment({ settingsModel, establishment }) {
  if (!establishment || typeof establishment !== 'object') return [];
  const row = settingsModel.read();
  const payload = {};
  for (const [key, column] of Object.entries(ESTABLISHMENT_COLUMNS)) {
    const value = String(establishment[key] == null ? '' : establishment[key]).replace(/[\r\n]+/g, ' ').trim();
    if (value && !String(row[column] || '').trim()) payload[column] = value;
  }
  settingsModel.upsert(payload);
  return Object.keys(payload);
}

module.exports = { createFirstAdmin, seedEstablishment, splitName, ESTABLISHMENT_COLUMNS, REISSUE };
