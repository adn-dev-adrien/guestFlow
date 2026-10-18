/**
 * The development mail catcher — `GUESTFLOW_MAIL_OUTBOX=<dir>` (specs/guest-email-texts-made-simple.md
 * rule 26, specs/hosting-h2-account-security.md rule 6). Set outside production, every email GuestFlow
 * would send — account emails, guest emails, notifications, tests — is written as one JSON file in that
 * directory instead: the « recette » mode, safe on a copy of the production database. Ignored when
 * NODE_ENV=production, where the variable must never stop the real emails.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function outboxDir(env = process.env) {
  if (env.NODE_ENV === 'production') return null;
  return String(env.GUESTFLOW_MAIL_OUTBOX || '').trim() || null;
}

/** Writes `{ to, subject, text, from?, replyTo?, at }` as `<ms>-<hex>.json`; → the file path. */
function writeToOutbox(dir, { to, subject, text, from, replyTo }, now = new Date()) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${now.getTime()}-${crypto.randomBytes(4).toString('hex')}.json`);
  const message = { to, subject, text, ...(from ? { from } : {}), ...(replyTo ? { replyTo } : {}), at: now.toISOString() };
  fs.writeFileSync(file, JSON.stringify(message, null, 2));
  return file;
}

module.exports = { outboxDir, writeToOutbox };
