/**
 * Email identity — one address typed once (specs/settings-rationalization.md rule 12).
 *
 * The « Email de contact » of Établissement is the source. Every other address or name GuestFlow
 * sends with falls back to it unless the operator overrode it:
 *   fromEmail  ← smtpFromEmail              || companyEmail
 *   username   ← smtpUsername               || fromEmail
 *   fromName   ← smtpFromName               || companyName || 'GuestFlow'
 *   recipient  ← notificationRecipientEmail || fromEmail
 *
 * Pure: takes an `app_settings` row (raw or masked), returns trimmed strings.
 */

const DEFAULT_SENDER_NAME = 'GuestFlow';

const clean = (value) => (value == null ? '' : String(value).trim());

function resolveEmailIdentity(row = {}) {
  const fromEmail = clean(row.smtpFromEmail) || clean(row.companyEmail);
  return {
    fromEmail,
    username: clean(row.smtpUsername) || fromEmail,
    fromName: clean(row.smtpFromName) || clean(row.companyName) || DEFAULT_SENDER_NAME,
    recipient: clean(row.notificationRecipientEmail) || fromEmail,
  };
}

module.exports = { resolveEmailIdentity, DEFAULT_SENDER_NAME };
