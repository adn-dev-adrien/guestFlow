/**
 * The mail transport of the account emails — reset links and login codes
 * (specs/hosting-h2-account-security.md rules 5, 6). It is the instance's own SMTP (Réglages ›
 * Emails), the one the user invitations already use.
 *
 * `GUESTFLOW_MAIL_OUTBOX=<dir>` (development and E2E only, refused when NODE_ENV=production) writes
 * each email as a JSON file in that directory instead of sending it: the dev mail catcher the E2E
 * suite reads the reset link from.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createEmailService } = require('./emailService');

function outboxDir(env) {
  if (env.NODE_ENV === 'production') return null;
  return String(env.GUESTFLOW_MAIL_OUTBOX || '').trim() || null;
}

function createAccountMailer({ settingsModel, env = process.env, buildEmailService = createEmailService, now = () => new Date() }) {
  return {
    available() {
      return Boolean(outboxDir(env)) || settingsModel.smtpConfigured();
    },

    // The address links point to: the configured public URL, else the one the hosting sets. Never
    // the request's Host header, which a caller chooses.
    publicUrl() {
      const url = String(settingsModel.publicUrl() || env.GUESTFLOW_PUBLIC_URL || '').trim();
      return url.replace(/\/+$/, '');
    },

    async send({ to, subject, text }) {
      const dir = outboxDir(env);
      if (dir) {
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${now().getTime()}-${crypto.randomBytes(4).toString('hex')}.json`);
        fs.writeFileSync(file, JSON.stringify({ to, subject, text, at: now().toISOString() }, null, 2));
        return { outbox: file };
      }
      return buildEmailService(settingsModel.decryptedSmtpSettings()).send({ to, subject, text });
    },
  };
}

module.exports = { createAccountMailer, outboxDir };
