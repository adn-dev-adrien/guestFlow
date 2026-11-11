/**
 * The customer emails of the renewal (specs/control-plane-plans-and-access.md rules 17, 33): their
 * default texts, the placeholders they may use, and the rendering. Pure.
 *
 * A placeholder is `{{name}}`. An unknown one is refused when a template is saved, never discovered
 * later in a sent email.
 */

const PLACEHOLDERS = [
  'contactName', 'companyName', 'planName', 'period', 'amount',
  'deadline', 'invoiceNumber', 'invoiceUrl', 'payUrl', 'spaceUrl',
];

// The scheduled emails, in the order a period meets them, and « Relancer maintenant ».
const KINDS = {
  invoice: { name: 'Facture', day: 'J-7 en mensuel, J-30 en annuel' },
  reminder_before: { name: 'Relance J-7', day: 'J-7, en annuel seulement' },
  reminder_due: { name: 'Relance jour J', day: 'le jour de l’échéance' },
  reminder_after: { name: 'Relance J+7', day: '7 jours après l’échéance' },
  reminder_manual: { name: 'Relancer maintenant', day: 'au clic, depuis la fiche client' },
};

const SIGNATURE = '\n\nMerci de votre confiance,\nL’équipe GuestFlow';

const DEFAULT_TEMPLATES = [
  {
    key: 'invoice',
    subject: 'Votre facture GuestFlow {{invoiceNumber}}',
    body: 'Bonjour {{contactName}},\n\nVotre abonnement GuestFlow {{planName}} se renouvelle le {{deadline}}. Voici votre facture {{invoiceNumber}} ({{amount}} TTC) pour la période {{period}}.\n\nLa facture : {{invoiceUrl}}\nPayer en ligne : {{payUrl}}'
      + SIGNATURE,
  },
  {
    key: 'reminder_before',
    subject: 'Votre abonnement GuestFlow se termine le {{deadline}}',
    body: 'Bonjour {{contactName}},\n\nPetit rappel : votre abonnement GuestFlow {{planName}} se termine le {{deadline}}. La facture {{invoiceNumber}} ({{amount}} TTC) est en attente de règlement.\n\nLa facture : {{invoiceUrl}}\nPayer en ligne : {{payUrl}}'
      + SIGNATURE,
  },
  {
    key: 'reminder_due',
    subject: 'Votre abonnement GuestFlow se termine aujourd’hui',
    body: 'Bonjour {{contactName}},\n\nVotre abonnement GuestFlow {{planName}} se termine aujourd’hui. La facture {{invoiceNumber}} ({{amount}} TTC) est en attente de règlement.\n\nLa facture : {{invoiceUrl}}\nPayer en ligne : {{payUrl}}'
      + SIGNATURE,
  },
  {
    key: 'reminder_after',
    subject: 'Abonnement GuestFlow échu',
    body: 'Bonjour {{contactName}},\n\nVotre abonnement GuestFlow {{planName}} est échu depuis le {{deadline}}. Sans règlement, votre espace {{spaceUrl}} passera en lecture seule dans quelques jours : vos données resteront consultables.\n\nLa facture : {{invoiceUrl}}\nPayer en ligne : {{payUrl}}'
      + SIGNATURE,
  },
  {
    key: 'reminder_manual',
    subject: 'Relance : facture GuestFlow {{invoiceNumber}}',
    body: 'Bonjour {{contactName}},\n\nNous n’avons pas encore reçu le règlement de la facture {{invoiceNumber}} ({{amount}} TTC), à régler avant le {{deadline}}.\n\nLa facture : {{invoiceUrl}}\nPayer en ligne : {{payUrl}}'
      + SIGNATURE,
  },
];

const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** The first problem with a subject and a body, or null. */
function templateError(subject, body) {
  if (!String(subject || '').trim() || !String(body || '').trim()) {
    return { code: 'EMPTY', message: 'L’objet et le texte sont obligatoires.' };
  }
  for (const text of [subject, body]) {
    for (const match of String(text).matchAll(TOKEN)) {
      if (!PLACEHOLDERS.includes(match[1])) {
        return {
          code: 'UNKNOWN_PLACEHOLDER',
          message: `Variable inconnue : {{${match[1]}}}. Variables possibles : ${PLACEHOLDERS.map((p) => `{{${p}}}`).join(', ')}.`,
        };
      }
    }
  }
  return null;
}

function render(text, vars) {
  return String(text).replace(TOKEN, (whole, name) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name] ?? '') : whole));
}

module.exports = { PLACEHOLDERS, KINDS, DEFAULT_TEMPLATES, templateError, render };
