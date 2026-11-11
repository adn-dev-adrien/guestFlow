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

/**
 * Writes `{ to, subject, text, html?, mime?, from?, replyTo?, at }` as `<ms>-<hex>.json`; → the file path.
 * A guest email carries its HTML part (specs/guest-email-texts-made-simple.md rule 37) and, in `mime`,
 * the message exactly as the SMTP server would receive it, so its `multipart/alternative` can be read.
 */
function writeToOutbox(dir, { to, subject, text, html, mime, from, replyTo }, now = new Date()) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${now.getTime()}-${crypto.randomBytes(4).toString('hex')}.json`);
  const message = {
    to, subject, text,
    ...(html ? { html } : {}),
    ...(mime ? { mime } : {}),
    ...(from ? { from } : {}),
    ...(replyTo ? { replyTo } : {}),
    at: now.toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(message, null, 2));
  return file;
}

/** The raw RFC 5322 message nodemailer would hand to the SMTP server. */
async function composeMime(message) {
  const MailComposer = require('nodemailer/lib/mail-composer');
  return String(await new MailComposer(message).compile().build());
}

/** `writeToOutbox`, with the raw message added when the email has an HTML part. */
async function writeMessageToOutbox(dir, message, now = new Date()) {
  const mime = message.html ? await composeMime(message) : undefined;
  return writeToOutbox(dir, { ...message, mime }, now);
}

module.exports = { outboxDir, writeToOutbox, writeMessageToOutbox, composeMime };
