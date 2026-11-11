/**
 * The console's outgoing email: the operators' login codes and the export link of a deprovisioned
 * customer (C2b adds the renewal reminders). SMTP comes from `CP_SMTP_*`. Without a host, outside
 * production, messages are written to the log instead — that is how a dev reads a login code.
 */

const nodemailer = require('nodemailer');
const { smtpEhloName } = require('./gf');

function createMailer(env = process.env, log = (msg) => console.log(msg)) {
  const host = env.CP_SMTP_HOST;
  const from = env.CP_SMTP_FROM || 'Console GuestFlow <console@guestflow.local>';
  if (!host) {
    return {
      async send({ to, subject, text }) {
        if (env.NODE_ENV === 'production') throw new Error('CP_SMTP_HOST is not set');
        log(`[mail] to=${to} subject=${subject}\n${text}`);
      },
    };
  }
  const secure = String(env.CP_SMTP_PORT) === '465';
  const auth = env.CP_SMTP_USER ? { user: env.CP_SMTP_USER, pass: env.CP_SMTP_PASS } : undefined;
  const name = smtpEhloName.ehloName(from);
  const transport = nodemailer.createTransport({
    host,
    port: Number(env.CP_SMTP_PORT || 587),
    secure,
    auth,
    // A login never leaves in clear (specs/admin-account-management.md rule 16, reading of 2026-11-04).
    requireTLS: Boolean(auth) && !secure,
    // Greets with the From domain, never the VM's `[127.0.0.1]` (specs/admin-account-management.md rule 21, audit R35-CON-L1).
    ...(name ? { name } : {}),
  });
  return {
    async send({ to, subject, text }) {
      await transport.sendMail({ from, to, subject, text });
    },
  };
}

module.exports = { createMailer };
