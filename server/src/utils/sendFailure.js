/**
 * The French reason of a failed send, for the operator (specs/email-automation.md rule 15). The
 * transport's own text (« Missing credentials for "PLAIN" », « EMAIL_SEND_FAILED ») means nothing to
 * an owner; the reason says what happened and where to fix it. Pure.
 */

const MESSAGES = Object.freeze({
  notConfigured: 'Envoi non configuré : Paramètres › Emails.',
  auth: 'Serveur d’envoi refusé : vérifier Paramètres › Emails.',
  unreachable: 'Serveur d’envoi injoignable : vérifier Paramètres › Emails.',
  recipient: 'Adresse du destinataire refusée.',
  other: 'Envoi impossible : réessayer plus tard.',
});

function sendFailureMessage(err) {
  const code = String((err && err.code) || '');
  const text = String((err && err.message) || '');
  // The platform's daily quota already speaks French (utils/platformMail.js).
  if (code === 'PLATFORM_MAIL_DAILY_LIMIT') return text || 'Envoi refusé : limite quotidienne atteinte.';
  if (code === 'EMAIL_NOT_CONFIGURED') return MESSAGES.notConfigured;
  if (code === 'EAUTH' || /credentials|authentication|535|534/i.test(text)) return MESSAGES.auth;
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ENOTFOUND', 'ECONNREFUSED'].includes(code) || /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|getaddrinfo/i.test(text)) {
    return MESSAGES.unreachable;
  }
  if (code === 'EENVELOPE' || Number(err && err.responseCode) === 550) return MESSAGES.recipient;
  return MESSAGES.other;
}

module.exports = { sendFailureMessage, MESSAGES };
