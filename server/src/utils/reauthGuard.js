/**
 * The limit on a password typed to confirm a sensitive action (specs/hosting-h2-account-security.md
 * rule 49): 5 wrong passwords within 15 minutes lock every route that asks for it — the second step's
 * activation, disabling and new backup codes, and the password change — for 15 minutes, per account.
 * One guard is shared by all of them, so none is a way around another.
 *
 * In memory, in the process that answers: a restart clears it, and a second process would count apart
 * (production runs a single process). An empty password is not a guess and counts for nothing. While
 * locked, even the right password is refused.
 */

const { httpError } = require('./httpError');
const { createWindowCounter } = require('./rateLimiter');

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

const parisTime = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });

// « Trop d’essais : réessayer après 14:32 (dans 12 min). » + the seconds left, for the client to count down.
function lockedError(code, untilIso, nowDate) {
  const seconds = Math.max(1, Math.ceil((new Date(untilIso).getTime() - nowDate.getTime()) / 1000));
  const left = seconds >= 60 ? `${Math.ceil(seconds / 60)} min` : `${seconds} s`;
  return httpError(429, code, `Trop d’essais : réessayer après ${parisTime(untilIso)} (dans ${left}).`, { retryInSeconds: seconds });
}

function createReauthGuard({ users, now = () => new Date(), onLock = () => {} }) {
  const failures = createWindowCounter({
    windowMs: LOCK_MINUTES * 60000, max: MAX_FAILURES - 1, now: () => now().getTime(), sweepMs: 0,
  });
  const locks = new Map();

  function assertOpen(userId) {
    const until = locks.get(userId);
    if (!until) return;
    if (until > now().toISOString()) throw lockedError('REAUTH_LOCKED', until, now());
    locks.delete(userId);
  }

  // → the verified user, or null for a wrong or empty password; throws REAUTH_LOCKED when locked, and
  // on the 5th wrong password.
  function check(user, password) {
    assertOpen(user.id);
    const typed = String(password || '');
    const verified = users.verifyCredentials(user.email, typed);
    if (verified) return verified;
    if (!typed || failures.hit(user.id)) return null;
    const until = new Date(now().getTime() + LOCK_MINUTES * 60000).toISOString();
    locks.set(user.id, until);
    onLock(user.id);
    throw lockedError('REAUTH_LOCKED', until, now());
  }

  return { assertOpen, check };
}

module.exports = { createReauthGuard, lockedError, MAX_FAILURES, LOCK_MINUTES };
