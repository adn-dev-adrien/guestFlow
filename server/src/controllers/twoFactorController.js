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
 * The activation of 2026-10-28 (rules 38-53): a three-step enrolment that expires after 15 minutes and
 * can be cancelled, the tries left on a wrong code, the email code as a fallback inside an enrolment,
 * a replacement of the method that never leaves the account unprotected (rule 48), a current code asked
 * with the password for every sensitive change (rule 47), and a limit on the confirmation password
 * (rule 49).
 *
 * Every method takes plain values and throws `httpError`s; the HTTP glue lives in authController.
 */

const crypto = require('crypto');
const QRCode = require('qrcode');
const totp = require('../utils/totp');
const deviceTrust = require('../utils/deviceTrust');
const { httpError } = require('../utils/httpError');
const { ADMIN, userHasRole } = require('../constants/roles');
const { createReauthGuard, lockedError } = require('../utils/reauthGuard');

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const EMAIL_CODE_MINUTES = 10;
const SNOOZE_DAYS = 30;
const ENROLMENT_MINUTES = 15;
const RESEND_SECONDS = 60;
const MAX_SENDS = 5;
const MAX_MAILS_PER_HOUR = 6;
const BACKUP_LOW_AT = 3;
const CLOCK_HINT_AT = 3;
const ISSUER = 'GuestFlow';
const METHODS = ['totp', 'email'];
const METHOD_LABELS = { totp: 'Appli d’authentification', email: 'Code par email' };
const EVENT_LABELS = {
  enabled_totp: () => 'Validation en deux étapes activée (appli)',
  enabled_email: () => 'Validation en deux étapes activée (email)',
  disabled: () => 'Validation en deux étapes désactivée',
  disabled_by_admin: (actor) => `Validation en deux étapes désactivée par ${actor || 'un administrateur'}`,
  disabled_by_script: () => 'Validation en deux étapes désactivée en ligne de commande',
  backup_regenerated: () => 'Nouveaux codes de secours',
  password_reset: () => 'Mot de passe réinitialisé par lien',
  replaced_totp: () => 'Appli d’authentification changée',
  replaced_email: () => 'Passage au code par email',
  reauth_locked: () => 'Trop d’essais du mot de passe',
};

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const sixDigits = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const maskEmail = (email) => String(email).replace(/^(.)(.*)(.@)/, (m, a, mid, b) => `${a}${'•'.repeat(Math.max(mid.length, 1))}${b}`);
const parisTime = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
const parisDate = (iso) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' });
const parisDateTime = (iso) => new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fullName = (u) => [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email;

const plural = (n, one, many) => (n === 1 ? one : many);
const hashToken = (token) => sha256(`2fa-enrolment:${token || ''}`);
const newToken = () => crypto.randomBytes(32).toString('hex');
const sameHash = (a, b) => Boolean(a && b) && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function createTwoFactorController({
  model, users, mailer, trustSecret, now = () => new Date(), qr = QRCode, companyName = () => '', passwordGuard,
}) {
  const nowIso = () => now().toISOString();
  const lockedMessage = (until) => `Trop d’essais : réessayer après ${parisTime(until)}.`;
  const inMinutes = (iso, minutes) => new Date(new Date(iso).getTime() + minutes * 60000).toISOString();

  // Rule 49 — the confirmation password's limit, shared with the password change (utils/reauthGuard.js).
  const guard = passwordGuard || createReauthGuard({
    users, now, onLock: (userId) => model.addEvent(userId, 'reauth_locked', '', nowIso()),
  });

  function assertPassword(user, password) {
    if (!guard.check(user, password)) throw httpError(400, 'BAD_PASSWORD', 'Mot de passe incorrect.');
  }

  function assertNotLocked(row, { detailed = false } = {}) {
    if (!row || !row.lockedUntil || row.lockedUntil <= nowIso()) return;
    throw detailed ? lockedError('LOCKED', row.lockedUntil, now()) : httpError(429, 'LOCKED', lockedMessage(row.lockedUntil));
  }

  // `purpose`: 'login' and 'setup' share the login code; 'action' (a re-authentication) has its own, so
  // asking for one never cancels the other.
  async function sendEmailCode(user, purpose) {
    if (!mailer.available()) throw httpError(400, 'EMAIL_UNAVAILABLE', 'Aucun envoi d’email configuré.');
    const code = sixDigits();
    const expires = new Date(now().getTime() + EMAIL_CODE_MINUTES * 60000).toISOString();
    if (purpose === 'action') model.setActionCode(user.id, sha256(code), expires);
    else model.setEmailCode(user.id, sha256(code), expires);
    await mailer.send({
      to: user.email,
      subject: purpose === 'login' ? 'Code de connexion — GuestFlow' : 'Code de confirmation — GuestFlow',
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

  function checkActionCode(userId, row, code) {
    if (!row || !row.actionCodeHash || !row.actionCodeExpiresAt || row.actionCodeExpiresAt <= nowIso()) return false;
    const ok = crypto.timingSafeEqual(Buffer.from(row.actionCodeHash), Buffer.from(sha256(String(code || '').trim())));
    if (ok) model.clearActionCode(userId);
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

  function pendingState(row) {
    const startedAt = row && row.pendingMethod ? row.pendingStartedAt : null;
    // A NULL start is an enrolment begun before rule 43: expired.
    const expiresAt = startedAt ? inMinutes(startedAt, ENROLMENT_MINUTES) : null;
    return { method: row && row.pendingMethod, expiresAt, fresh: Boolean(expiresAt && expiresAt > nowIso()) };
  }

  function status(user) {
    const row = model.get(user.id);
    const enabled = Boolean(row && row.enabledAt);
    const snoozed = model.snoozedUntil(user.id);
    const left = enabled ? model.unusedBackupCodes(user.id).length : 0;
    const low = enabled && left <= BACKUP_LOW_AT;
    const list = events(user.id);
    return {
      enabled,
      method: enabled ? row.method : null,
      methodLabel: enabled ? METHOD_LABELS[row.method] : null,
      enabledLabel: enabled ? `depuis le ${parisDate(row.enabledAt)}` : null,
      backupCodesLeft: left,
      backupCodesTotal: totp.BACKUP_CODE_COUNT,
      backupCodesLabel: enabled ? `${left} ${plural(left, 'code de secours', 'codes de secours')} sur ${totp.BACKUP_CODE_COUNT}` : null,
      backupCodesLow: low,
      backupCodesWarning: low ? (left === 0 ? 'Aucun code de secours.' : `Plus ${plural(left, 'qu’un code', `que ${left} codes`)} de secours.`) : null,
      emailAvailable: mailer.available(),
      reauthNeedsCode: enabled,
      // Rule 10: the dashboard card of an admin without a second step, unless « Plus tard ».
      nudge: !enabled && !user.isSupport && userHasRole(user, ADMIN) && !(snoozed && snoozed > nowIso()),
      events: list,
      eventsCount: list.length,
    };
  }

  // Rule 47 — a current code, on top of the password: the app's, a backup code (spent), or the code
  // just emailed. A wrong one counts toward the lock of rule 8; the TOTP step used cannot open a session.
  function assertCurrentCode(user, row, code) {
    assertNotLocked(row, { detailed: true });
    const value = totp.normalizeCode(code);
    if (!value) throw httpError(400, 'CODE_REQUIRED', 'Saisir un code actuel.');
    let ok;
    if (totp.isBackupCodeShape(value)) {
      ok = useBackupCode(user.id, value);
    } else if (row.method === 'totp') {
      const step = row.secretEncrypted ? totp.matchTotpStep(row.secretEncrypted, value, now()) : null;
      ok = step !== null && model.useTotpStep(user.id, step);
    } else {
      ok = checkActionCode(user.id, row, value);
    }
    if (!ok) {
      model.recordFailure(user.id);
      if (row.failedCount + 1 >= MAX_FAILURES) {
        const until = inMinutes(nowIso(), LOCK_MINUTES);
        model.lock(user.id, until);
        throw lockedError('LOCKED', until, now());
      }
      const left = MAX_FAILURES - (row.failedCount + 1);
      throw httpError(400, 'BAD_CODE', `Code incorrect : ${left} ${plural(left, 'essai restant', 'essais restants')}.`, { attemptsLeft: left });
    }
    model.resetFailures(user.id);
  }

  // The password, then the current code: the guard of disabling, of new backup codes and of a new method.
  function reauthenticate(user, { password, code } = {}) {
    assertPassword(user, password);
    const row = model.get(user.id);
    if (!row || !row.enabledAt) throw httpError(409, 'NOT_ENABLED', 'Aucune validation en deux étapes active.');
    assertCurrentCode(user, row, code);
  }

  // Rule 59 — the guard of a change to the account's own identity: the password, then a current code
  // when the second step is on. Same limits as the other re-authentications (rules 8, 47, 49).
  function reauthenticateForChange(user, { password, code } = {}) {
    assertPassword(user, password);
    const row = model.get(user.id);
    if (row && row.enabledAt) assertCurrentCode(user, row, code);
  }

  // Why a mail slot was refused — the 60 s gap, the enrolment's 5 sends, the hour's mails.
  function assertMayResend(row, enrolment, login = false) {
    if (enrolment && row.pendingSends >= MAX_SENDS) {
      throw httpError(429, 'TOO_MANY_SENDS', 'Trop d’envois : recommencer l’activation.');
    }
    if (row.lastCodeSentAt) {
      const wait = Math.ceil((new Date(row.lastCodeSentAt).getTime() + RESEND_SECONDS * 1000 - now().getTime()) / 1000);
      if (wait > 0) {
        throw httpError(429, 'RESEND_TOO_SOON', `Nouvel envoi possible dans ${wait} s.`, { retryInSeconds: wait });
      }
    }
    const [since, sent] = login ? [row.loginMailsSince, row.loginMailsSent] : [row.mailsSince, row.mailsSent];
    if (since && since > new Date(now().getTime() - 3600000).toISOString() && sent >= MAX_MAILS_PER_HOUR) {
      throw httpError(429, 'TOO_MANY_SENDS', 'Trop d’envois : réessayer plus tard.');
    }
  }

  // Rules 44, 55 — the slot is taken before the mail is sent, in one conditional UPDATE, so parallel
  // requests cannot all pass a check made before the first of them wrote.
  function reserveMailSlot(userId, { enrolment = false, login = false } = {}) {
    model.ensure(userId);
    const at = now().getTime();
    const taken = model.reserveMailSlot(userId, {
      nowIso: new Date(at).toISOString(),
      gapBeforeIso: new Date(at - RESEND_SECONDS * 1000).toISOString(),
      hourAgoIso: new Date(at - 3600000).toISOString(),
      enrolment,
      login,
      maxSends: MAX_SENDS,
      maxPerHour: MAX_MAILS_PER_HOUR,
    });
    if (taken) return;
    assertMayResend(model.get(userId), enrolment, login);
    throw httpError(429, 'RESEND_TOO_SOON', `Nouvel envoi possible dans ${RESEND_SECONDS} s.`, { retryInSeconds: RESEND_SECONDS });
  }

  const sentTo = (user) => ({ sentTo: maskEmail(user.email), resendInSeconds: RESEND_SECONDS });

  async function start(user, { method, password, code, enrolmentToken } = {}) {
    if (!METHODS.includes(method)) throw httpError(400, 'INVALID_METHOD', 'Méthode inconnue.');
    const row = model.get(user.id);
    const enabled = Boolean(row && row.enabledAt);
    if (enabled && row.method === 'email' && method === 'email') {
      throw httpError(409, 'SAME_METHOD', 'Le code par email est déjà la méthode active.');
    }
    if (method === 'email' && !mailer.available()) throw httpError(400, 'EMAIL_UNAVAILABLE', 'Aucun envoi d’email configuré.');
    // Rule 44 — inside a FIRST activation opened with the password, the method may be switched without
    // asking it again, by whoever holds the enrolment's token (random, handed back by the opening call and
    // kept by the dialog; only its hash is stored — a session cookie alone is not enough). A replacement
    // of an active step is never switched without the password and a current code.
    const pending = pendingState(row);
    const switching = !password && !enabled && pending.fresh && sameHash(row.pendingTokenHash, hashToken(enrolmentToken));
    let token = enrolmentToken;
    if (!switching) {
      assertPassword(user, password);
      if (enabled) assertCurrentCode(user, row, code);
      token = newToken();
    }
    const startedAt = switching ? row.pendingStartedAt : nowIso();
    const expiresAt = inMinutes(startedAt, ENROLMENT_MINUTES);
    const replacing = enabled;
    if (method === 'totp') {
      const secret = totp.generateSecret();
      if (switching) model.switchPending(user.id, 'totp', secret);
      else model.setPending(user.id, 'totp', secret, { startedAt, tokenHash: hashToken(token) });
      const accountLabel = [companyName(), user.email].map((v) => String(v || '').trim()).filter(Boolean).join(' · ');
      const uri = totp.otpauthUri({ secret, account: accountLabel, issuer: ISSUER });
      return {
        method,
        qrDataUrl: await qr.toDataURL(uri, { margin: 2, width: 400 }),
        secret: totp.groupSecret(secret),
        otpauthUri: uri,
        issuer: ISSUER,
        accountLabel,
        replacing,
        expiresAt,
        enrolmentToken: token,
      };
    }
    if (switching) {
      reserveMailSlot(user.id, { enrolment: true });
      model.switchPending(user.id, 'email', null);
    } else {
      reserveMailSlot(user.id);
      model.setPending(user.id, 'email', null, { startedAt, tokenHash: hashToken(token) });
      model.markEnrolmentSend(user.id);
    }
    await sendEmailCode(user, 'setup');
    return { method, ...sentTo(user), replacing, expiresAt, enrolmentToken: token };
  }

  // Rule 44/47 — « Renvoyer le code » of an email enrolment, or « Recevoir un code » of a re-auth.
  async function sendCode(user) {
    const row = model.get(user.id);
    const pending = pendingState(row);
    if (pending.fresh && pending.method === 'email') {
      reserveMailSlot(user.id, { enrolment: true });
      await sendEmailCode(user, 'setup');
      return sentTo(user);
    }
    if (row && row.enabledAt && row.method === 'email') {
      reserveMailSlot(user.id);
      await sendEmailCode(user, 'action');
      return sentTo(user);
    }
    throw httpError(409, 'NOT_EMAIL', 'Aucun code par email à envoyer.');
  }

  // Rule 40 — leaving the activation drops the enrolment in progress, and only it.
  function cancel(user) {
    model.dropPending(user.id);
  }

  function confirm(user, { code, forgetTrustedDevices } = {}) {
    const row = model.get(user.id);
    if (!row || !row.pendingMethod) throw httpError(409, 'NO_PENDING_METHOD', 'Choisir d’abord une méthode.');
    if (!pendingState(row).fresh) {
      model.dropPending(user.id);
      throw httpError(410, 'ENROLMENT_EXPIRED', 'Activation expirée : recommencer.');
    }
    // Rule 24 — the step of the enrolment code is recorded: the same code cannot then open a session.
    const step = row.pendingMethod === 'totp' ? totp.matchTotpStep(row.pendingSecretEncrypted, code, now()) : null;
    const ok = row.pendingMethod === 'totp' ? step !== null : checkEmailCode(user.id, row, code);
    if (!ok) {
      model.recordPendingFailure(user.id);
      const failures = row.pendingFailures + 1;
      if (failures >= MAX_FAILURES) {
        model.dropPending(user.id);
        throw httpError(429, 'TOO_MANY_CODES', 'Trop de codes incorrects : activation annulée.');
      }
      const left = MAX_FAILURES - failures;
      const hint = row.pendingMethod === 'totp' && failures >= CLOCK_HINT_AT ? ' Vérifier l’heure du téléphone.' : '';
      throw httpError(400, 'BAD_CODE', `Code incorrect : ${left} ${plural(left, 'essai restant', 'essais restants')}.${hint}`, { attemptsLeft: left });
    }
    const replacing = Boolean(row.enabledAt);
    const { codes, hashes } = freshBackupCodes();
    // Rule 48 — a new app forgets the trusted devices (the trust is bound to `enabledAt`) unless the
    // user unticked « Oublier les appareils de confiance ».
    model.activatePending(user.id, nowIso(), hashes, step, { keepEnabledAt: replacing && forgetTrustedDevices === false });
    model.addEvent(user.id, `${replacing ? 'replaced' : 'enabled'}_${row.pendingMethod}`, '', nowIso());
    return { backupCodes: codes, status: status(user) };
  }

  function disable(user, body = {}) {
    reauthenticate(user, body);
    model.disable(user.id);
    model.addEvent(user.id, 'disabled', '', nowIso());
    return status(user);
  }

  function regenerate(user, body = {}) {
    reauthenticate(user, body);
    const { codes, hashes } = freshBackupCodes();
    model.replaceBackupCodes(user.id, hashes);
    model.addEvent(user.id, 'backup_regenerated', '', nowIso());
    return { backupCodes: codes, status: status(user) };
  }

  // Rule 9 — an administrator turns another user's step off (a lost phone). Never reads it.
  function disableFor(actor, targetId) {
    const target = users.findById(targetId);
    if (!target || target.isSupport) throw httpError(404, 'USER_NOT_FOUND', 'Compte introuvable.');
    if (!model.isEnabled(target.id)) throw httpError(409, 'NOT_ENABLED', 'Aucune validation en deux étapes active.');
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
    // Rule 62 — the login mail takes a slot like every code mail (rule 55). A right password repeated
    // meets the limit: no new mail, the code already sent stays the one to type.
    let mailed = false;
    if (row.method === 'email') {
      try {
        reserveMailSlot(user.id, { login: true });
        mailed = true;
      } catch (err) {
        if (!(err && err.status === 429)) throw err;
      }
      if (mailed) await sendEmailCode(user, 'login');
    }
    let message = `Code envoyé à ${maskEmail(user.email)}, valable ${EMAIL_CODE_MINUTES} minutes.`;
    if (row.method === 'totp') message = 'Code à 6 chiffres de l’appli d’authentification.';
    else if (!mailed) message = `Code déjà envoyé à ${maskEmail(user.email)}.`;
    return { step: 'second-factor', method: row.method, message };
  }

  const activeUser = (userId) => {
    const user = users.findById(userId);
    return user && user.isActive && !user.isSupport ? user : null;
  };

  // → { user, notice } — `user` is the safe user to put in the session.
  function verifyLogin(userId, { code } = {}) {
    // A user deactivated between the password and the code is refused (specs/security-auth-encryption.md rule 3).
    const user = activeUser(userId);
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
    const user = activeUser(userId);
    const row = user && model.get(userId);
    if (!user || !row || !row.enabledAt) throw httpError(401, 'NO_PENDING_LOGIN', 'Reconnexion nécessaire.');
    if (row.method !== 'email') throw httpError(400, 'NOT_EMAIL', 'Méthode : appli d’authentification.');
    assertNotLocked(row);
    reserveMailSlot(userId, { login: true });
    await sendEmailCode(user, 'login');
    return { message: 'Nouveau code envoyé ; le précédent ne marche plus.' };
  }

  function issueTrust(userId) {
    const inputs = trustInputs(userId);
    return { name: deviceTrust.cookieName(userId), value: deviceTrust.issue(inputs), maxAge: deviceTrust.TRUST_MS };
  }

  return {
    status, start, sendCode, cancel, confirm, disable, regenerate, disableFor, snooze,
    isRequired, beginLogin, verifyLogin, resendLogin, issueTrust, reauthenticateForChange,
    MAX_FAILURES, LOCK_MINUTES, EVENT_LABELS,
  };
}

module.exports = { createTwoFactorController, METHOD_LABELS, EVENT_LABELS };
