/**
 * Forgotten password (specs/hosting-h2-account-security.md rules 1–5).
 *
 * - The answer to a request never says whether the address has an account (rule 1), and costs the
 *   same time either way: the email leaves after the answer.
 * - A link is valid 1 hour and works once; only the SHA-256 of its token is stored; a new link voids
 *   the older ones (rule 2).
 * - 3 requests per address and 20 per IP per hour; above, the same answer and nothing sent (rule 3).
 * - Saving the new password ends every session of the user (rule 4). The route then logs the user
 *   in — through the second step when one is on (§3 edge case: a reset never bypasses it).
 * - Without a mail transport, or without the address links point to, the link is not offered (rule 5).
 */

const crypto = require('crypto');
const { httpError } = require('../utils/httpError');
const { createWindowCounter } = require('../utils/rateLimiter');
const { MIN_PASSWORD_LENGTH } = require('../constants/authDefaults');

const LINK_MINUTES = 60;
const HOUR_MS = 60 * 60 * 1000;
const PER_EMAIL = 3;
const PER_IP = 20;
const SAME_ANSWER = 'Si un compte existe, un lien vient d’être envoyé.';

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const normalizeEmail = (v) => String(v || '').trim().toLowerCase();

function createPasswordResetController({
  users,
  model,
  mailer,
  twoFactorModel,
  now = () => new Date(),
  log = (msg) => console.error(msg),
}) {
  const nowIso = () => now().toISOString();
  const perEmail = createWindowCounter({ windowMs: HOUR_MS, max: PER_EMAIL, now: () => now().getTime() });
  const perIp = createWindowCounter({ windowMs: HOUR_MS, max: PER_IP, now: () => now().getTime() });

  const available = () => mailer.available() && Boolean(mailer.publicUrl());

  function options() {
    return { forgotPassword: available() };
  }

  // → { message, delivery } — `delivery` is the pending send (tests await it; the route does not).
  function request({ email, ip }) {
    const answer = { message: SAME_ANSWER };
    const address = normalizeEmail(email);
    if (!available() || !address) return { ...answer, delivery: Promise.resolve(false) };
    const ipOk = perIp.hit(ip || 'unknown');
    const emailOk = perEmail.hit(address);
    if (!ipOk || !emailOk) return { ...answer, delivery: Promise.resolve(false) };

    const user = users.findByEmail(address);
    if (!user || !user.isActive || user.isSupport) return { ...answer, delivery: Promise.resolve(false) };

    const token = crypto.randomBytes(32).toString('base64url');
    model.create(user.id, sha256(token), new Date(now().getTime() + LINK_MINUTES * 60000).toISOString(), nowIso());
    const link = `${mailer.publicUrl()}/nouveau-mot-de-passe?token=${token}`;
    const delivery = Promise.resolve()
      .then(() => mailer.send({
        to: user.email,
        subject: 'Réinitialisation du mot de passe — GuestFlow',
        text: `Lien de réinitialisation, valable 1 heure et utilisable une fois :\n${link}\n\nSans demande de réinitialisation, ignorer ce message.`,
      }))
      .then(() => true)
      .catch((err) => {
        log(`[passwordReset] email send failed: ${err && err.message}`);
        return false;
      });
    return { ...answer, delivery };
  }

  function check(token) {
    return { valid: Boolean(token && model.findUsable(sha256(token), nowIso())) };
  }

  // → { user } — the safe user whose password was set. Sessions are ended before it returns.
  function reset({ token, password }) {
    if (String(password || '').length < MIN_PASSWORD_LENGTH) {
      throw httpError(400, 'PASSWORD_TOO_SHORT', `Au moins ${MIN_PASSWORD_LENGTH} caractères.`);
    }
    const row = token ? model.findUsable(sha256(token), nowIso()) : null;
    if (!row || !model.consume(row.id, nowIso())) {
      throw httpError(400, 'INVALID_TOKEN', 'Lien expiré ou déjà utilisé.');
    }
    const user = users.findById(row.userId);
    if (!user || !user.isActive || user.isSupport) throw httpError(400, 'INVALID_TOKEN', 'Lien expiré ou déjà utilisé.');
    users.updatePassword(user.id, password);
    model.endSessionsOf(user.id);
    if (twoFactorModel) twoFactorModel.addEvent(user.id, 'password_reset', '', nowIso());
    return { user: users.findById(user.id) };
  }

  return { options, request, check, reset, SAME_ANSWER, LINK_MINUTES, PER_EMAIL, PER_IP };
}

module.exports = { createPasswordResetController, SAME_ANSWER };
