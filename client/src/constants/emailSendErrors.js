// The send dialog's errors in French (specs/email-automation.md rule 15). The server already words
// a transport failure; a bare code is never shown to the operator.
const BY_CODE = Object.freeze({
  EMAIL_NOT_CONFIGURED: 'Envoi non configuré : Paramètres › Emails.',
  CLIENT_NO_EMAIL: 'Adresse destinataire manquante.',
  INVALID_EMAIL: 'Adresse email invalide.',
});

export const NO_RECIPIENT = BY_CODE.CLIENT_NO_EMAIL;
export const SEND_FALLBACK = 'Envoi impossible : réessayer plus tard.';

const isCode = (text) => /^[A-Z][A-Z_]+$/.test(String(text || ''));

export function sendErrorMessage(err) {
  const code = (err && err.error) || '';
  if (BY_CODE[code]) return BY_CODE[code];
  const message = String((err && err.message) || '');
  if (BY_CODE[message]) return BY_CODE[message];
  return message && !isCode(message) ? message : SEND_FALLBACK;
}
