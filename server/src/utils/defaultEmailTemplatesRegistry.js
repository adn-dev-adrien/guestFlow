/**
 * Default email templates registry (specs/email-automation.md §3 rule 6).
 *
 * This is the **single source of truth** for every default template GuestFlow ships out
 * of the box. Each entry is a self-contained object — adding a new default email is
 * therefore one file change: append an object below, write a one-line test case
 * asserting it seeds, and you're done. No DB migration, no controller change.
 *
 * Contract for each entry:
 *   - `stableKey` — unique-across-the-registry string, snake_case. The seed uses it as
 *     the lookup key, so it MUST stay stable across boots (renaming it would re-insert
 *     a duplicate). Naming convention: `<purpose>_<offset>` (e.g. `arrival_reminder_7d`).
 *   - `name`      — operator-facing label.
 *   - `subject`   — plain text, supports `{{tokens}}`.
 *   - `body`      — plain text, supports `{{tokens}}` + single-level `{{#if}}…{{/if}}`.
 *   - `dayOffset` — integer; -7 = 7 days before startDate, +1 = day after, 0 = day J.
 *   - `sendMode`  — `'auto'` | `'manual'`. Default templates ship with `'manual'` so the
 *     operator reviews them before the first send.
 *   - `enabled`   — boolean. Ship enabled by default.
 *
 * Supported tokens + conditional flags live in `utils/emailContextBuilder.js`.
 */

const ARRIVAL_REMINDER_7D_BODY = [
  'Bonjour {{clientFirstName}},',
  '',
  'Votre séjour {{propertyWithArticle}} approche, nous nous réjouissons de vous accueillir.',
  '',
  'Rappel des informations de votre séjour :',
  '{{#if hasReservationNumber}}- N° de réservation : {{reservationNumber}}',
  '{{/if}}- Logement : {{propertyName}}',
  '- Arrivée  : le {{startDate}} à partir de {{checkInTime}}',
  '- Départ   : le {{endDate}} avant {{checkOutTime}}',
  '{{#if hasOptions}}- Options choisies : {{optionsList}}',
  '{{/if}}',
  'Afin de préparer au mieux votre arrivée, pourriez-vous nous indiquer votre heure d\'arrivée estimée ?',
  '',
  '{{#if hasBedLinenOption}}Vous avez souscrit à l\'option linge de lit. La configuration prévue pour le logement est : {{bedConfig}}.',
  'Si cette configuration ne vous convient pas, n\'hésitez pas à nous le faire savoir avant votre arrivée afin que nous puissions ajuster la mise en place.',
  '',
  '{{/if}}',
  '{{#if hasBabyBedNotice}}{{babyBedNotice}}',
  '',
  '{{/if}}',
  '{{#if cautionNotBanked}}Pour rappel, la caution de {{cautionAmount}} n\'a pas été prélevée par virement bancaire. Merci de prévoir un chèque de caution du même montant à remettre le jour de votre arrivée.',
  '',
  '{{/if}}',
  'Nous restons à votre disposition pour toute question ; n\'hésitez pas à nous joindre par retour de cet email ou au {{companyPhone}}.',
  '',
  'À très bientôt,',
  '{{senderName}}',
].join('\n');

// Arrival reminder sent at J-2 (specs/j1-arrival-reminder-email.md). Warm tone; conditional blocks
// render only when relevant. Sends 2 days before arrival → the copy uses the stay date, never
// "demain". Linen logic (3 states):
//   - property provides linen by default → "beds made on arrival" (the linen option is dropped from
//     the "Option(s) réservée(s)" list server-side, via {{reservedOptionsList}});
//   - linen neither provided nor booked → "bring your own linen" ({{#if bedLinenBringYourOwn}});
//   - linen booked as a paid add-on → no message, listed in the options.
// `hasCleaningOption` / `hasNordicBath` are matched on the option/resource NAME (emailContextBuilder).
// The stableKey stays `arrival_reminder_1d` (legacy) even though it's now J-2 — renaming it would
// re-seed a duplicate; the operator-facing name is "Rappel arrivée — J-2".
const ARRIVAL_REMINDER_1D_BODY = [
  'Bonjour {{clientFirstName}},',
  '',
  'C\'est avec grand plaisir que nous vous accueillons le {{startDate}} {{propertyWithArticle}} !',
  'Voici les informations utiles avant votre arrivée.',
  '',
  'Votre séjour :',
  '{{#if hasReservationNumber}}- N° de réservation : {{reservationNumber}}',
  '{{/if}}- Logement : {{propertyName}}',
  '- Arrivée  : le {{startDate}} à partir de {{checkInTime}}',
  '- Départ   : le {{endDate}} avant {{checkOutTime}}',
  '{{#if hasReservedOptions}}- Option(s) réservée(s) : {{reservedOptionsList}}',
  '{{/if}}{{#if hasResources}}- Équipements réservés : {{resourcesList}}',
  '{{/if}}',
  'Pour vous rendre sur place, recherchez simplement « Domaine Solio » sur votre GPS.',
  '',
  '{{#if cautionNotReceived}}Pour finaliser votre arrivée, pensez à prévoir un chèque de caution de {{cautionAmount}} à nous remettre sur place.',
  '',
  '{{/if}}{{#if complementToCollect}}{{complementNotice}}',
  '',
  '{{/if}}{{#if bedLinenProvidedByDefault}}Pour votre confort, les lits seront faits à votre arrivée.',
  '',
  '{{/if}}{{#if bedLinenBringYourOwn}}Le linge de lit n\'est pas inclus dans votre réservation : pensez à apporter le vôtre (draps, taies d\'oreiller). Vous pouvez aussi nous demander de l\'ajouter, avec plaisir.',
  '',
  '{{/if}}{{#if hasCleaningOption}}{{else}}Le ménage de fin de séjour n\'a pas été réservé : il reste à votre charge avant le départ. N\'hésitez pas si vous souhaitez l\'ajouter, nous nous en occupons volontiers.',
  '',
  '{{/if}}{{#if hasNordicBath}}{{nordicBathReminder}}',
  '',
  '{{/if}}Nous restons à votre entière disposition d\'ici là — répondez simplement à cet email ou appelez-nous au {{companyPhone}}.',
  '',
  'Très belles vacances, et à très bientôt !',
  '{{senderName}}',
].join('\n');

// English translations (specs/email-language-fr-en.md). Same tokens + {{#if}} flags + block structure
// as the French bodies — only the prose changes. Sent when the reservation's emailLanguage = 'en'.
const ARRIVAL_REMINDER_7D_BODY_EN = [
  'Hello {{clientFirstName}},',
  '',
  'Your stay at {{propertyWithArticle}} is approaching, and we look forward to welcoming you.',
  '',
  'A reminder of your stay details:',
  '{{#if hasReservationNumber}}- Reservation no.: {{reservationNumber}}',
  '{{/if}}- Property : {{propertyName}}',
  '- Arrival  : {{startDate}} from {{checkInTime}}',
  '- Departure: {{endDate}} before {{checkOutTime}}',
  '{{#if hasOptions}}- Options chosen: {{optionsList}}',
  '{{/if}}',
  'To prepare for your arrival as best we can, could you let us know your estimated arrival time?',
  '',
  '{{#if hasBedLinenOption}}You have subscribed to the bed-linen option. The configuration planned for the property is: {{bedConfig}}.',
  'If this configuration does not suit you, please let us know before your arrival so that we can adjust the setup.',
  '',
  '{{/if}}',
  '{{#if hasBabyBedNotice}}{{babyBedNotice}}',
  '',
  '{{/if}}',
  '{{#if cautionNotBanked}}As a reminder, the security deposit of {{cautionAmount}} has not been taken by bank transfer. Please plan to bring a deposit cheque of the same amount to hand over on the day of your arrival.',
  '',
  '{{/if}}',
  'We remain at your disposal for any question; do not hesitate to reach us by replying to this email or at {{companyPhone}}.',
  '',
  'See you very soon,',
  '{{senderName}}',
].join('\n');

const ARRIVAL_REMINDER_1D_BODY_EN = [
  'Hello {{clientFirstName}},',
  '',
  'We are delighted to welcome you on {{startDate}} at {{propertyWithArticle}}!',
  'Here is some useful information before your arrival.',
  '',
  'Your stay:',
  '{{#if hasReservationNumber}}- Reservation no.: {{reservationNumber}}',
  '{{/if}}- Property : {{propertyName}}',
  '- Arrival  : {{startDate}} from {{checkInTime}}',
  '- Departure: {{endDate}} before {{checkOutTime}}',
  '{{#if hasReservedOptions}}- Option(s) booked: {{reservedOptionsList}}',
  '{{/if}}{{#if hasResources}}- Equipment booked: {{resourcesList}}',
  '{{/if}}',
  'To reach us, simply search for « Domaine Solio » on your GPS.',
  '',
  '{{#if cautionNotReceived}}To finalise your arrival, please plan to bring a deposit cheque of {{cautionAmount}} to hand over on site.',
  '',
  '{{/if}}{{#if complementToCollect}}{{complementNotice}}',
  '',
  '{{/if}}{{#if bedLinenProvidedByDefault}}For your comfort, the beds will be made on your arrival.',
  '',
  '{{/if}}{{#if bedLinenBringYourOwn}}Bed linen is not included in your reservation: please remember to bring your own (sheets, pillowcases). You may also ask us to add it, with pleasure.',
  '',
  '{{/if}}{{#if hasCleaningOption}}{{else}}End-of-stay cleaning has not been booked: it remains your responsibility before departure. Do not hesitate if you would like to add it, we will gladly take care of it.',
  '',
  '{{/if}}{{#if hasNordicBath}}{{nordicBathReminder}}',
  '',
  '{{/if}}We remain entirely at your disposal until then — simply reply to this email or call us at {{companyPhone}}.',
  '',
  'Have a wonderful stay, and see you very soon!',
  '{{senderName}}',
].join('\n');

// Reservation confirmation — EVENT-triggered (sent by utils/reservationEmailSender when an online
// payment confirms the stay: acompte reçu OR paiement total). NOT date-driven: `dayOffset` is a
// sentinel and it's kept out of the manual queue (emailLogModel.listPending) + the auto cron
// (sendMode 'manual'). Editable like any template in the Emails page.
const RESERVATION_CONFIRMATION_BODY = [
  'Bonjour {{clientFirstName}},',
  '',
  'Nous avons bien reçu votre paiement : votre réservation {{propertyWithArticle}} est confirmée. Merci !',
  '',
  'Récapitulatif de votre séjour :',
  '{{#if hasReservationNumber}}- N° de réservation : {{reservationNumber}}',
  '{{/if}}- Logement : {{propertyName}}',
  '- Arrivée  : le {{startDate}} à partir de {{checkInTime}}',
  '- Départ   : le {{endDate}} avant {{checkOutTime}}',
  '{{#if hasReservedOptions}}- Option(s) réservée(s) : {{reservedOptionsList}}',
  '{{/if}}{{#if hasResources}}- Équipements réservés : {{resourcesList}}',
  '{{/if}}- Montant du séjour : {{finalPrice}}',
  '',
  'Vous recevrez les informations pratiques d\'arrivée à l\'approche de votre séjour. Pour toute question, répondez simplement à cet email ou appelez-nous au {{companyPhone}}.',
  '',
  'À très bientôt,',
  '{{senderName}}',
].join('\n');

const RESERVATION_CONFIRMATION_BODY_EN = [
  'Hello {{clientFirstName}},',
  '',
  'We have received your payment: your reservation at {{propertyWithArticle}} is confirmed. Thank you!',
  '',
  'Summary of your stay:',
  '{{#if hasReservationNumber}}- Reservation no.: {{reservationNumber}}',
  '{{/if}}- Property : {{propertyName}}',
  '- Arrival  : {{startDate}} from {{checkInTime}}',
  '- Departure: {{endDate}} before {{checkOutTime}}',
  '{{#if hasReservedOptions}}- Option(s) booked: {{reservedOptionsList}}',
  '{{/if}}{{#if hasResources}}- Equipment booked: {{resourcesList}}',
  '{{/if}}- Stay amount: {{finalPrice}}',
  '',
  'You will receive practical arrival information as your stay approaches. For any question, simply reply to this email or call us at {{companyPhone}}.',
  '',
  'See you soon,',
  '{{senderName}}',
].join('\n');

const DEFAULT_TEMPLATES = Object.freeze([
  Object.freeze({
    stableKey: 'arrival_reminder_7d',
    name:      'Rappel arrivée — J-7',
    subject:   'Préparation de votre séjour {{propertyWithArticle}}',
    body:      ARRIVAL_REMINDER_7D_BODY,
    subjectEn: 'Preparing your stay at {{propertyWithArticle}}',
    bodyEn:    ARRIVAL_REMINDER_7D_BODY_EN,
    dayOffset: -7,
    sendMode:  'manual',
    enabled:   true,
  }),
  Object.freeze({
    stableKey: 'arrival_reminder_1d',
    name:      'Rappel arrivée — J-2',
    subject:   'Votre arrivée approche {{propertyWithArticle}}',
    body:      ARRIVAL_REMINDER_1D_BODY,
    subjectEn: 'Your arrival is approaching at {{propertyWithArticle}}',
    bodyEn:    ARRIVAL_REMINDER_1D_BODY_EN,
    dayOffset: -2,
    sendMode:  'manual',
    enabled:   true,
  }),
  Object.freeze({
    stableKey: 'reservation_confirmation',
    name:      'Confirmation de réservation (paiement reçu)',
    subject:   'Confirmation de votre réservation {{propertyWithArticle}}',
    body:      RESERVATION_CONFIRMATION_BODY,
    subjectEn: 'Confirmation of your reservation at {{propertyWithArticle}}',
    bodyEn:    RESERVATION_CONFIRMATION_BODY_EN,
    dayOffset: 0,          // sentinel — event-triggered, never date-scheduled (see listPending exclusion)
    sendMode:  'manual',   // cron only auto-sends 'auto'; this one is sent programmatically on payment
    enabled:   true,
  }),
  // ───────────────────────────────────────────────────────────────────────────────
  // Add new default templates below. One object per template; follow the contract
  // documented at the top of this file. Re-uses any of the variables / flags listed in
  // `utils/emailContextBuilder.js`. Add a matching test case in
  // `tests/default-email-templates-seed.unit.test.js` so the seed coverage stays exhaustive.
  // ───────────────────────────────────────────────────────────────────────────────
]);

module.exports = {
  DEFAULT_TEMPLATES,
  // Exposed verbatim for tests that need the same body string the seed inserts.
  ARRIVAL_REMINDER_7D_BODY,
  ARRIVAL_REMINDER_1D_BODY,
  ARRIVAL_REMINDER_7D_BODY_EN,
  ARRIVAL_REMINDER_1D_BODY_EN,
};
