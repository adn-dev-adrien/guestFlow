/**
 * The mail transport of the account emails — reset links and login codes
 * (specs/hosting-h2-account-security.md rules 5, 6). It is the instance's own SMTP (Réglages ›
 * Emails), the one the user invitations already use.
 *
 * `GUESTFLOW_MAIL_OUTBOX=<dir>` (utils/mailOutbox.js) writes each email as a JSON file instead of
 * sending it: the dev mail catcher the E2E suite reads the reset link from. Here it also makes the
 * account emails available on an instance with no SMTP at all.
 */

const { createEmailService } = require('./emailService');
const { outboxDir, writeToOutbox } = require('./mailOutbox');

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
      if (dir) return { outbox: writeToOutbox(dir, { to, subject, text }, now()) };
      return buildEmailService(settingsModel.decryptedSmtpSettings()).send({ to, subject, text });
    },
  };
}

module.exports = { createAccountMailer, outboxDir };
