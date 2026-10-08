/**
 * Second step of the login (specs/hosting-h2-account-security.md rules 6–10), on the TOTP and
 * backup-code helpers shared with the console (rule 11, utils/totp.js).
 *
 * - Turning it on (« Mon compte ») takes the password, then a first code of the chosen method; it
 *   issues 10 backup codes, shown once and stored with the password hash (rule 6).
 * - At login, a user with a second step and no trusted device gets the second-step screen (rule 7).
 *   Five wrong codes lock the step for 15 minutes (rule 8). A TOTP code is accepted once.
 * - An administrator turns another user's step off, recorded in that user's history (rule 9).
 * - The dashboard card for an admin without it, hidden 30 days by « Plus tard » (rule 10).
 *
 * Every method takes plain values and throws `httpError`s; the HTTP glue lives in authController.
 */

const crypto = require('crypto');
const QRCode = require('qrcode');
const totp = require('../utils/totp');
const deviceTrust = require('../utils/deviceTrust');
const { httpError } = require('../utils/httpError');
const { ADMIN, userHasRole } = require('../constants/roles');

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const EMAIL_CODE_MINUTES = 10;
const SNOOZE_DAYS = 30;
const METHODS = ['totp', 'email'];
const METHOD_LABELS = { totp: 'Appli d’authentification', email: 'Code par email' };
const EVENT_LABELS = {
  enabled_totp: () => 'Second code activé (appli)',
  enabled_email: () => 'Second code activé (email)',
  disabled: () => 'Second code désactivé',
  disabled_by_admin: (actor) => `Second code désactivé par ${actor || 'un administrateur'}`,
  disabled_by_script: () => 'Second code désactivé en ligne de commande',
  backup_regenerated: () => 'Nouveaux codes de secours',
  password_reset: () => 'Mot de passe réinitialisé par lien',
};

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const sixDigits = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const maskEmail = (email) => String(email).replace(/^(.)(.*)(.@)/, (m, a, mid, b) => `${a}${'•'.repeat(Math.max(mid.length, 1))}${b}`);
const parisTime = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
const parisDateTime = (iso) => new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fullName = (u) => [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email;

function createTwoFactorController({ model, users, mailer, trustSecret, now = () => new Date(), qr = QRCode }) {
  const nowIso = () => now().toISOString();
  const lockedMessage = (until) => `Trop d’essais : réessayer après ${parisTime(until)}.`;

  function assertPassword(user, password) {
    if (!users.verifyCredentials(user.email, String(password || ''))) {
      throw httpError(400, 'BAD_PASSWORD', 'Mot de passe incorrect.');
    }
  }

  function assertNotLocked(row) {
    if (row && row.lockedUntil && row.lockedUntil > nowIso()) throw httpError(429, 'LOCKED', lockedMessage(row.lockedUntil));
  }

  async function sendEmailCode(user, purpose) {
    if (!mailer.available()) throw httpError(400, 'EMAIL_UNAVAILABLE', 'Aucun envoi d’email configuré.');
    const code = sixDigits();
    model.setEmailCode(user.id, sha256(code), new Date(now().getTime() + EMAIL_CODE_MINUTES * 60000).toISOString());
    await mailer.send({
      to: user.email,
      subject: purpose === 'setup' ? 'Code de confirmation — GuestFlow' : 'Code de connexion — GuestFlow',
      text: `Code : ${code}\n\nValable ${EMAIL_CODE_MINUTES} minutes. Un nouveau code annule le précédent.`,
    });
  }

  function checkEmailCode(userId, row, code) {
    if (!row || !row.emailCodeHash || !row.emailCodeExpiresAt || row.emailCodeExpiresAt <= nowIso()) return false;
    const given = Buffer.from(sha256(String(code || '').trim()));
    const ok = crypto.timingSafeEqual(Buffer.from(row.emailCodeHash), given);
    if (ok) model.clearEmailCode(userId);
    return ok;
  }

  function useBackupCode(userId, code) {
    const rows = model.unusedBackupCodes(userId);
    const match = totp.findBackupCode(code, rows.map((r) => r.codeHash));
    if (!match) return false;
    return model.useBackupCode(rows.find((r) => r.codeHash === match).id, nowIso());
  }

  function freshBackupCodes() {
    const codes = totp.generateBackupCodes();
    return { codes, hashes: codes.map(totp.hashBackupCode) };
  }

  function events(userId) {
    return model.events(userId).map((e) => ({
      at: e.at,
      atLabel: parisDateTime(e.at),
      label: (EVENT_LABELS[e.event] || (() => e.event))(e.actor),
    }));
  }

  // ----- « Mon compte » -----

  function status(user) {
    const row = model.get(user.id);
    const enabled = Boolean(row && row.enabledAt);
    const snoozed = model.snoozedUntil(user.id);
    return {
      enabled,
      method: enabled ? row.method : null,
      methodLabel: enabled ? METHOD_LABELS[row.method] : null,
      backupCodesLeft: enabled ? model.unusedBackupCodes(user.id).length : 0,
      emailAvailable: mailer.available(),
      // Rule 10: the dashboard card of an admin without a second step, unless « Plus tard ».
      nudge: !enabled && !user.isSupport && userHasRole(user, ADMIN) && !(snoozed && snoozed > nowIso()),
      events: events(user.id),
    };
  }

  async function start(user, { method, password } = {}) {
    if (!METHODS.includes(method)) throw httpError(400, 'INVALID_METHOD', 'Méthode inconnue.');
    assertPassword(user, password);
    if (method === 'totp') {
      const secret = totp.generateSecret();
      model.setPending(user.id, 'totp', secret);
      const uri = totp.otpauthUri({ secret, account: user.email });
      return {
        method,
        qrDataUrl: await qr.toDataURL(uri, { margin: 1, width: 220 }),
        secret: totp.groupSecret(secret),
      };
    }
    model.setPending(user.id, 'email', null);
    await sendEmailCode(user, 'setup');
    return { method, sentTo: maskEmail(user.email) };
  }

  function confirm(user, { code } = {}) {
    const row = model.get(user.id);
    if (!row || !row.pendingMethod) throw httpError(409, 'NO_PENDING_METHOD', 'Choisir d’abord une méthode.');
    const ok = row.pendingMethod === 'totp'
      ? totp.verifyTotp(row.pendingSecretEncrypted, code, now())
      : checkEmailCode(user.id, row, code);
    if (!ok) {
      model.recordPendingFailure(user.id);
      if (row.pendingFailures + 1 >= MAX_FAILURES) {
        model.dropPending(user.id);
        throw httpError(429, 'TOO_MANY_CODES', 'Trop de codes incorrects : activation annulée.');
      }
      throw httpError(400, 'BAD_CODE', 'Code incorrect.');
    }
    const { codes, hashes } = freshBackupCodes();
    model.activatePending(user.id, nowIso(), hashes);
    model.addEvent(user.id, `enabled_${row.pendingMethod}`, '', nowIso());
    return { backupCodes: codes, status: status(user) };
  }

  function disable(user, { password } = {}) {
    assertPassword(user, password);
    if (!model.isEnabled(user.id)) throw httpError(409, 'NOT_ENABLED', 'Aucun second code actif.');
    model.disable(user.id);
    model.addEvent(user.id, 'disabled', '', nowIso());
    return status(user);
  }

  function regenerate(user, { password } = {}) {
    assertPassword(user, password);
    if (!model.isEnabled(user.id)) throw httpError(409, 'NOT_ENABLED', 'Aucun second code actif.');
    const { codes, hashes } = freshBackupCodes();
    model.replaceBackupCodes(user.id, hashes);
    model.addEvent(user.id, 'backup_regenerated', '', nowIso());
    return { backupCodes: codes, status: status(user) };
  }

  // Rule 9 — an administrator turns another user's step off (a lost phone). Never reads it.
  function disableFor(actor, targetId) {
    const target = users.findById(targetId);
    if (!target || target.isSupport) throw httpError(404, 'USER_NOT_FOUND', 'Compte introuvable.');
    if (!model.isEnabled(target.id)) throw httpError(409, 'NOT_ENABLED', 'Aucun second code actif.');
    model.disable(target.id);
    model.addEvent(target.id, 'disabled_by_admin', fullName(actor), nowIso());
    return { userId: target.id, twoFactorEnabled: false };
  }

  function snooze(user) {
    const until = new Date(now().getTime() + SNOOZE_DAYS * 86400000).toISOString();
    model.snooze(user.id, until);
    return { snoozedUntil: until };
  }

  // ----- login -----

  function trustInputs(userId) {
    const row = model.get(userId);
    return { secret: trustSecret, userId, stamp: users.credentialStamp(userId), enabledAt: row && row.enabledAt, now: now() };
  }

  // Whether this login needs the second step: a step is on and the device is not trusted.
  function isRequired(user, trustToken) {
    if (!model.isEnabled(user.id)) return false;
    return !deviceTrust.isTrusted(trustToken, trustInputs(user.id));
  }

  // The second-step screen, once the password was right. « Locked » is said only after it.
  async function beginLogin(user) {
    const row = model.get(user.id);
    assertNotLocked(row);
    if (row.method === 'email') await sendEmailCode(user, 'login');
    return {
      step: 'second-factor',
      method: row.method,
      message: row.method === 'totp'
        ? 'Code à 6 chiffres de l’appli d’authentification.'
        : `Code envoyé à ${maskEmail(user.email)}, valable ${EMAIL_CODE_MINUTES} minutes.`,
    };
  }

  // → { user, notice } — `user` is the safe user to put in the session.
  function verifyLogin(userId, { code } = {}) {
    const user = users.findById(userId);
    const row = user && model.get(userId);
    if (!user || !row || !row.enabledAt) throw httpError(401, 'NO_PENDING_LOGIN', 'Reconnexion nécessaire.');
    assertNotLocked(row);
    const value = totp.normalizeCode(code);
    let ok = false;
    let usedBackup = false;
    if (totp.isBackupCodeShape(value)) {
      ok = usedBackup = useBackupCode(userId, value);
    } else if (row.method === 'totp') {
      const step = row.secretEncrypted ? totp.matchTotpStep(row.secretEncrypted, value, now()) : null;
      ok = step !== null && model.useTotpStep(userId, step);
    } else {
      ok = checkEmailCode(userId, row, value);
    }
    if (!ok) {
      model.recordFailure(userId);
      if (row.failedCount + 1 >= MAX_FAILURES) {
        const until = new Date(now().getTime() + LOCK_MINUTES * 60000).toISOString();
        model.lock(userId, until);
        throw httpError(429, 'LOCKED', lockedMessage(until));
      }
      throw httpError(401, 'BAD_CODE', 'Code incorrect.');
    }
    model.resetFailures(userId);
    const left = model.unusedBackupCodes(userId).length;
    return { user, notice: usedBackup ? `Code de secours utilisé ; il en reste ${left}.` : null };
  }

  async function resendLogin(userId) {
    const user = users.findById(userId);
    const row = user && model.get(userId);
    if (!user || !row || !row.enabledAt) throw httpError(401, 'NO_PENDING_LOGIN', 'Reconnexion nécessaire.');
    if (row.method !== 'email') throw httpError(400, 'NOT_EMAIL', 'Méthode : appli d’authentification.');
    assertNotLocked(row);
    await sendEmailCode(user, 'login');
    return { message: 'Nouveau code envoyé ; le précédent ne marche plus.' };
  }

  function issueTrust(userId) {
    const inputs = trustInputs(userId);
    return { name: deviceTrust.cookieName(userId), value: deviceTrust.issue(inputs), maxAge: deviceTrust.TRUST_MS };
  }

  return {
    status, start, confirm, disable, regenerate, disableFor, snooze,
    isRequired, beginLogin, verifyLogin, resendLogin, issueTrust,
    MAX_FAILURES, LOCK_MINUTES, EVENT_LABELS,
  };
}

module.exports = { createTwoFactorController, METHOD_LABELS, EVENT_LABELS };
