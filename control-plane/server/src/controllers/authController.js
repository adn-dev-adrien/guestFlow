/**
 * Operator login and second factor (specs/control-plane-plans-and-access.md rule 31).
 *
 * Login is two steps: the password opens a *pending* session; the second factor — a TOTP code, an
 * email code or a backup code — turns it into an operator session. Five wrong answers in a row lock
 * the account for 15 minutes. Changing the method takes effect only once a code of the new method
 * is typed, and issues 10 fresh backup codes, shown once.
 */

const crypto = require('crypto');
const QRCode = require('qrcode');
const { passwordHash } = require('../utils/gf');
const totp = require('../utils/totp');
const { httpError } = require('../utils/httpError');

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const EMAIL_CODE_MINUTES = 10;
const BACKUP_CODES = 10;
const BACKUP_RE = /^[a-z0-9]{5}-[a-z0-9]{5}$/;

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const sixDigits = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const backupCode = () => {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const pick = () => Array.from({ length: 5 }, () => alphabet[crypto.randomInt(0, alphabet.length)]).join('');
  return `${pick()}-${pick()}`;
};
const maskEmail = (email) => email.replace(/^(.)(.*)(.@)/, (m, a, mid, b) => `${a}${'•'.repeat(Math.max(mid.length, 1))}${b}`);

function createAuthController(ctx) {
  const { models, now, mailer, secrets } = ctx;
  const { operators } = models;

  const lockedMessage = (until) => `Trop d’essais : réessayez après ${new Date(until).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })}.`;

  function assertNotLocked(op) {
    if (op.lockedUntil && new Date(op.lockedUntil) > now()) throw httpError(429, 'LOCKED', lockedMessage(op.lockedUntil));
  }

  function fail(op) {
    operators.recordFailure(op.id);
    const fresh = operators.byId(op.id);
    if (fresh.failedCount >= MAX_FAILURES) {
      const until = new Date(now().getTime() + LOCK_MINUTES * 60000).toISOString();
      operators.lock(op.id, until);
      throw httpError(429, 'LOCKED', lockedMessage(until));
    }
  }

  async function sendEmailCode(op, purpose) {
    const code = sixDigits();
    operators.setCode(op.id, sha256(code), new Date(now().getTime() + EMAIL_CODE_MINUTES * 60000).toISOString());
    await mailer.send({
      to: op.email,
      subject: purpose === 'setup' ? 'Code de confirmation — Console GuestFlow' : 'Code de connexion — Console GuestFlow',
      text: `Votre code : ${code}\n\nIl est valable ${EMAIL_CODE_MINUTES} minutes. Un nouveau code annule le précédent.`,
    });
  }

  function checkEmailCode(op, code) {
    const row = operators.getCode(op.id);
    if (!row || new Date(row.expiresAt) <= now()) return false;
    const ok = crypto.timingSafeEqual(Buffer.from(row.codeHash), Buffer.from(sha256(String(code || '').trim())));
    if (ok) operators.clearCode(op.id);
    return ok;
  }

  function useBackupCode(op, code) {
    const hashes = JSON.parse(op.backupCodes || '[]');
    const h = sha256(String(code).trim().toLowerCase());
    if (!hashes.includes(h)) return false;
    operators.setBackupCodes(op.id, JSON.stringify(hashes.filter((x) => x !== h)));
    return true;
  }

  function secondStep(op) {
    return {
      step: 'second-factor',
      method: op.mfaMethod,
      message: op.mfaMethod === 'totp'
        ? 'Saisissez le code à 6 chiffres affiché par votre appli d’authentification.'
        : `Un code à 6 chiffres vient d’être envoyé à ${maskEmail(op.email)}. Il est valable ${EMAIL_CODE_MINUTES} minutes.`,
    };
  }

  // Step 1 → { operatorId (for the session's pending slot), step payload }
  async function login({ email, password }) {
    const op = operators.byEmail(email);
    if (!op) throw httpError(401, 'BAD_CREDENTIALS', 'Email ou mot de passe incorrect.');
    assertNotLocked(op);
    if (!passwordHash.verifyPassword(String(password || ''), op.passwordHash)) {
      fail(op);
      throw httpError(401, 'BAD_CREDENTIALS', 'Email ou mot de passe incorrect.');
    }
    if (op.mfaMethod === 'email') await sendEmailCode(op, 'login');
    return { operatorId: op.id, payload: secondStep(op) };
  }

  // Step 2 → { operator, backupCodesLeft? }
  function verify(operatorId, { code }) {
    const op = operators.byId(operatorId);
    if (!op) throw httpError(401, 'NO_PENDING_LOGIN', 'Reconnectez-vous.');
    assertNotLocked(op);
    const value = String(code || '').trim().toLowerCase();
    let ok = false;
    let usedBackup = false;
    if (BACKUP_RE.test(value)) ok = usedBackup = useBackupCode(op, value);
    else if (op.mfaMethod === 'totp') ok = Boolean(op.totpSecret) && totp.verifyTotp(secrets.decrypt(op.totpSecret), value, now());
    else ok = checkEmailCode(op, value);
    if (!ok) {
      fail(op);
      throw httpError(401, 'BAD_CODE', 'Code incorrect.');
    }
    operators.resetFailures(op.id);
    const fresh = operators.byId(op.id);
    return {
      operator: publicOperator(fresh),
      notice: usedBackup ? `Ce code de secours est maintenant utilisé ; il en reste ${JSON.parse(fresh.backupCodes).length}.` : null,
    };
  }

  async function resend(operatorId) {
    const op = operators.byId(operatorId);
    if (!op) throw httpError(401, 'NO_PENDING_LOGIN', 'Reconnectez-vous.');
    if (op.mfaMethod !== 'email') throw httpError(400, 'NOT_EMAIL', 'Votre méthode est l’appli d’authentification.');
    assertNotLocked(op);
    await sendEmailCode(op, 'login');
    return { message: 'Nouveau code envoyé ; le précédent ne marche plus.' };
  }

  function publicOperator(op) {
    return {
      id: op.id,
      email: op.email,
      name: op.name,
      mfaMethod: op.mfaMethod,
      mfaLabel: op.mfaMethod === 'totp' ? 'Appli d’authentification' : 'Code par email',
      backupCodesLeft: JSON.parse(op.backupCodes || '[]').length,
    };
  }

  function me(operatorId) {
    const op = operators.byId(operatorId);
    if (!op) throw httpError(401, 'UNAUTHENTICATED', 'Connectez-vous.');
    return publicOperator(op);
  }

  // Profile: start switching to a method; nothing changes until `confirmMethod`.
  async function startMethod(operatorId, { method }) {
    const op = operators.byId(operatorId);
    if (method === 'totp') {
      const secret = totp.generateSecret();
      operators.setPending(op.id, 'totp', secrets.encrypt(secret));
      const uri = totp.otpauthUri({ secret, account: op.email });
      return {
        method,
        message: 'Scannez ce code avec votre appli, puis saisissez le code affiché pour confirmer.',
        qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 220 }),
        secret: totp.groupSecret(secret),
      };
    }
    if (method === 'email') {
      operators.setPending(op.id, 'email', null);
      await sendEmailCode(op, 'setup');
      return { method, message: `Un code vient d’être envoyé à ${op.email}. Saisissez-le pour confirmer.` };
    }
    throw httpError(400, 'INVALID', 'Méthode inconnue.');
  }

  function confirmMethod(operatorId, { code }) {
    const op = operators.byId(operatorId);
    if (!op.pendingMethod) throw httpError(409, 'NO_PENDING_METHOD', 'Choisissez d’abord une méthode.');
    const ok = op.pendingMethod === 'totp'
      ? totp.verifyTotp(secrets.decrypt(op.pendingTotpSecret), code, now())
      : checkEmailCode(op, code);
    if (!ok) throw httpError(400, 'BAD_CODE', 'Code incorrect : la méthode actuelle reste en place.');
    const codes = Array.from({ length: BACKUP_CODES }, backupCode);
    operators.activatePending(op.id, JSON.stringify(codes.map(sha256)));
    const fresh = operators.byId(op.id);
    return {
      operator: publicOperator(fresh),
      backupCodes: codes,
      message: `${fresh.mfaMethod === 'totp' ? 'Appli d’authentification activée.' : 'Code par email activé.'} La méthode précédente est désactivée.`,
    };
  }

  return { login, verify, resend, me, startMethod, confirmMethod, MAX_FAILURES, LOCK_MINUTES };
}

module.exports = { createAuthController, sha256 };
