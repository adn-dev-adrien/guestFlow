// SMTP transport wrapper used by the account-management flow
// (specs/admin-account-management.md §3.4). The caller passes a fully-decrypted settings object;
// this module never touches `app_settings` or the encryption util — it just builds a nodemailer
// transport and ships the mail. Lazy transport build so unit tests can stub `transportFactory`
// and so a misconfigured SMTP never crashes the server at boot.

const nodemailer = require('nodemailer');
const { testEmailBody } = require('./emailTemplates');

function createEmailService(settings, { transportFactory = nodemailer.createTransport } = {}) {
  const host = String(settings && settings.host || '').trim();
  const fromEmail = String(settings && settings.fromEmail || '').trim();
  const fromName = String(settings && settings.fromName || '').trim() || 'GuestFlow';
  // `passwordDecryptFailed` (set by settingsModel.decryptedSmtpSettings) signals that an
  // SMTP password IS persisted in the DB but the current `GUESTFLOW_ENCRYPTION_KEY` can't
  // unlock it (typical cause: a deploy regenerated `.env.local` — fixed at the workflow
  // level by PR #96). Treating the service as not-configured surfaces the actionable
  // `EMAIL_NOT_CONFIGURED` code to the caller, instead of letting nodemailer try to auth
  // with an empty password and crash with an opaque transport error.
  const passwordDecryptFailed = Boolean(settings && settings.passwordDecryptFailed);
  const isConfigured = Boolean(host) && Boolean(fromEmail) && !passwordDecryptFailed;

  let transport = null;

  function getTransport() {
    if (!isConfigured) {
      const err = new Error('EMAIL_NOT_CONFIGURED');
      err.code = 'EMAIL_NOT_CONFIGURED';
      throw err;
    }
    if (transport) return transport;
    transport = transportFactory({
      host,
      port: Number(settings.port) || 587,
      secure: Boolean(settings.secure),
      auth: settings.user ? { user: settings.user, pass: settings.password || '' } : undefined,
    });
    return transport;
  }

  function fromHeader() {
    // RFC 5322: "Display Name" <user@host>. Quote the display name to tolerate punctuation.
    return `"${fromName.replace(/"/g, '\\"')}" <${fromEmail}>`;
  }

  async function send({ to, subject, text }) {
    if (!to) throw new Error('EMAIL_RECIPIENT_REQUIRED');
    const tx = getTransport();
    return tx.sendMail({
      from: fromHeader(),
      to,
      subject,
      text,
    });
  }

  async function sendTest(to) {
    const { subject, text } = testEmailBody({ fromName });
    return send({ to, subject, text });
  }

  return {
    isConfigured,
    send,
    sendTest,
  };
}

module.exports = {
  createEmailService,
};
