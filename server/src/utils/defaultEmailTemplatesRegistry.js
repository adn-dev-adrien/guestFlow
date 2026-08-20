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
  'La cafetière du logement est une machine à capsules (type Nespresso).',
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
  'The coffee machine in the property is a capsule machine (Nespresso-compatible).',
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

// Deposit request — ACTION-triggered (sent by paymentsController.sendPaymentRequestEmail when the host
// clicks « Envoyer la demande d'acompte »). The payment link is injected per-send as {{paymentLink}}
// (extraContext); like the confirmation it is kept out of the manual queue + the auto cron.
const DEPOSIT_REQUEST_BODY = [
  'Bonjour {{clientFirstName}},',
  '',
  'Pour confirmer votre séjour {{propertyWithArticle}}, il vous suffit de régler l\'acompte en ligne.',
  '',
  'Récapitulatif de votre séjour :',
  '- Logement : {{propertyName}}',
  '- Arrivée  : le {{startDate}} à partir de {{checkInTime}}',
  '- Départ   : le {{endDate}} avant {{checkOutTime}}',
  '{{#if hasReservedOptions}}- Option(s) : {{reservedOptionsList}}',
  '{{/if}}{{#if hasResources}}- Équipements : {{resourcesList}}',
  '{{/if}}- Montant total du séjour : {{finalPrice}}',
  '',
  'Acompte à régler maintenant : {{depositAmount}}',
  '',
  'Payer l\'acompte en ligne : {{paymentLink}}',
  '',
  'Important : le règlement de l\'acompte bloque vos dates. Tant qu\'il n\'est pas payé, les dates restent disponibles et peuvent être réservées par un autre client.',
  '',
  'Pour toute question, répondez simplement à cet email ou appelez-nous au {{companyPhone}}.',
  '',
  'À très bientôt,',
  '{{senderName}}',
].join('\n');

const DEPOSIT_REQUEST_BODY_EN = [
  'Hello {{clientFirstName}},',
  '',
  'To confirm your stay at {{propertyWithArticle}}, simply pay the deposit online.',
  '',
  'Summary of your stay:',
  '- Property : {{propertyName}}',
  '- Arrival  : {{startDate}} from {{checkInTime}}',
  '- Departure: {{endDate}} before {{checkOutTime}}',
  '{{#if hasReservedOptions}}- Option(s): {{reservedOptionsList}}',
  '{{/if}}{{#if hasResources}}- Equipment: {{resourcesList}}',
  '{{/if}}- Total stay amount: {{finalPrice}}',
  '',
  'Deposit to pay now: {{depositAmount}}',
  '',
  'Pay the deposit online: {{paymentLink}}',
  '',
  'Important: paying the deposit secures your dates. Until it is paid, the dates remain available and may be booked by another guest.',
  '',
  'For any question, simply reply to this email or call us at {{companyPhone}}.',
  '',
  'See you soon,',
  '{{senderName}}',
].join('\n');

// Balance request — sent when only the acompte was collected online (specs/public-online-deposit.md):
// automatically by the daily balance cron at the due date, and on demand by the host « Envoyer la
// demande de solde » action. The payment link is injected per-send as {{paymentLink}} (extraContext).
const BALANCE_REQUEST_BODY = [
  'Bonjour {{clientFirstName}},',
  '',
  'Votre acompte pour le séjour {{propertyWithArticle}} est bien reçu — merci ! Il vous reste à régler le solde.',
  '',
  'Récapitulatif de votre séjour :',
  '- Logement : {{propertyName}}',
  '- Arrivée  : le {{startDate}} à partir de {{checkInTime}}',
  '- Départ   : le {{endDate}} avant {{checkOutTime}}',
  '- Montant total du séjour : {{finalPrice}}',
  '- Acompte déjà réglé : {{depositAmount}}',
  '',
  'Solde à régler : {{balanceAmount}} (avant le {{balanceDueDate}})',
  '',
  'Payer le solde en ligne : {{paymentLink}}',
  '',
  'Pour toute question, répondez simplement à cet email ou appelez-nous au {{companyPhone}}.',
  '',
  'À très bientôt,',
  '{{senderName}}',
].join('\n');

const BALANCE_REQUEST_BODY_EN = [
  'Hello {{clientFirstName}},',
  '',
  'We have received your deposit for your stay at {{propertyWithArticle}} — thank you! The balance is now due.',
  '',
  'Summary of your stay:',
  '- Property : {{propertyName}}',
  '- Arrival  : {{startDate}} from {{checkInTime}}',
  '- Departure: {{endDate}} before {{checkOutTime}}',
  '- Total stay amount: {{finalPrice}}',
  '- Deposit already paid: {{depositAmount}}',
  '',
  'Balance to pay: {{balanceAmount}} (before {{balanceDueDate}})',
  '',
  'Pay the balance online: {{paymentLink}}',
  '',
  'For any question, simply reply to this email or call us at {{companyPhone}}.',
  '',
  'See you soon,',
  '{{senderName}}',
].join('\n');

// Deposit reminder — MANUAL, anchored on the devis validity date (validUntil). Surfaces in the manual
// pending queue for an open, deposit-unpaid devis; the host sends it by hand. Re-offers the existing
// open deposit link, injected at send time as {{paymentLink}} (emailsController.buildPreview).
// specs/payment-schedule-and-cancellation.md §3.7 rule 37 — the acompte reminder used to be scheduled
// off the devis validity date; it now fires on the acompte's own due date, which is anchored on the
// BOOKING day. The copy therefore speaks of a confirmed reservation whose acompte is due, not of a
// quote about to expire.
const DEPOSIT_REMINDER_BODY = [
  'Bonjour {{clientFirstName}},',
  '',
  'Nous n\'avons pas encore reçu l\'acompte de votre séjour {{propertyWithArticle}}, dont l\'échéance était fixée au {{depositDueDate}}.',
  '',
  'Récapitulatif de votre séjour :',
  '{{#if hasReservationNumber}}- N° de réservation : {{reservationNumber}}',
  '{{/if}}- Logement : {{propertyName}}',
  '- Arrivée  : le {{startDate}} à partir de {{checkInTime}}',
  '- Départ   : le {{endDate}} avant {{checkOutTime}}',
  '- Montant total du séjour : {{finalPrice}}',
  '',
  'Acompte à régler : {{depositAmount}}',
  '',
  '{{#if hasPaymentLink}}Régler l\'acompte en ligne : {{paymentLink}}{{else}}Contactez-nous pour recevoir votre lien de paiement.{{/if}}',
  '',
  'Sans règlement de votre part, nous serons contraints de remettre vos dates à la vente.',
  '',
  'Si le règlement vient d\'être effectué, merci de ne pas tenir compte de ce message.',
  '',
  'Pour toute question, répondez simplement à cet email ou appelez-nous au {{companyPhone}}.',
  '',
  'À très bientôt,',
  '{{senderName}}',
].join('\n');

const DEPOSIT_REMINDER_BODY_EN = [
  'Hello {{clientFirstName}},',
  '',
  'We have not yet received the deposit for your stay at {{propertyWithArticle}}, which was due on {{depositDueDate}}.',
  '',
  'Summary of your stay:',
  '{{#if hasReservationNumber}}- Reservation no.: {{reservationNumber}}',
  '{{/if}}- Property : {{propertyName}}',
  '- Arrival  : {{startDate}} from {{checkInTime}}',
  '- Departure: {{endDate}} before {{checkOutTime}}',
  '- Total stay amount: {{finalPrice}}',
  '',
  'Deposit to pay: {{depositAmount}}',
  '',
  '{{#if hasPaymentLink}}Pay the deposit online: {{paymentLink}}{{else}}Contact us to receive your payment link.{{/if}}',
  '',
  'Without your payment we will have to put your dates back on sale.',
  '',
  'If you have just paid, please disregard this message.',
  '',
  'For any question, simply reply to this email or call us at {{companyPhone}}.',
  '',
  'See you soon,',
  '{{senderName}}',
].join('\n');


// specs/payment-schedule-and-cancellation.md §3.7 rule 39 — the solde was requested at J-30 and has
// not arrived. This is the last message before the stay is cancelled: it names the exact date and
// says plainly what happens to the acompte.
const BALANCE_REMINDER_BODY = [
  'Bonjour {{clientFirstName}},',
  '',
  'Le solde de votre séjour {{propertyWithArticle}} devait nous parvenir le {{balanceDueDate}} et nous ne l\'avons pas encore reçu.',
  '',
  'Récapitulatif de votre séjour :',
  '{{#if hasReservationNumber}}- N° de réservation : {{reservationNumber}}',
  '{{/if}}- Logement : {{propertyName}}',
  '- Arrivée  : le {{startDate}} à partir de {{checkInTime}}',
  '- Départ   : le {{endDate}} avant {{checkOutTime}}',
  '- Montant total du séjour : {{finalPrice}}',
  '',
  'Solde à régler : {{balanceAmount}}',
  '',
  '{{#if hasPaymentLink}}Régler le solde en ligne : {{paymentLink}}{{else}}Contactez-nous pour recevoir votre lien de paiement.{{/if}}',
  '',
  'Sans règlement de votre part d\'ici le {{cancelOnDate}}, votre séjour sera annulé et l\'acompte déjà versé restera acquis à titre d\'indemnité.',
  '',
  'Si le règlement vient d\'être effectué, merci de ne pas tenir compte de ce message.',
  '',
  'Pour toute question, répondez simplement à cet email ou appelez-nous au {{companyPhone}}.',
  '',
  'Bien à vous,',
  '{{senderName}}',
].join('\n');

const BALANCE_REMINDER_BODY_EN = [
  'Hello {{clientFirstName}},',
  '',
  'The balance for your stay at {{propertyWithArticle}} was due on {{balanceDueDate}} and we have not received it yet.',
  '',
  'Summary of your stay:',
  '{{#if hasReservationNumber}}- Reservation no.: {{reservationNumber}}',
  '{{/if}}- Property : {{propertyName}}',
  '- Arrival  : {{startDate}} from {{checkInTime}}',
  '- Departure: {{endDate}} before {{checkOutTime}}',
  '- Total stay amount: {{finalPrice}}',
  '',
  'Balance to pay: {{balanceAmount}}',
  '',
  '{{#if hasPaymentLink}}Pay the balance online: {{paymentLink}}{{else}}Contact us to receive your payment link.{{/if}}',
  '',
  'Without your payment by {{cancelOnDate}}, your stay will be cancelled and the deposit already paid will be retained as compensation.',
  '',
  'If you have just paid, please disregard this message.',
  '',
  'For any question, simply reply to this email or call us at {{companyPhone}}.',
  '',
  'Kind regards,',
  '{{senderName}}',
].join('\n');

// specs/payment-schedule-and-cancellation.md §3.7 rule 40 — sent the moment the operator confirms the
// cancellation. The retained-acompte block only renders when something was actually kept: cancelling
// a reservation whose acompte never arrived keeps nothing (rule 27).
const CANCELLATION_NOTICE_BODY = [
  'Bonjour {{clientFirstName}},',
  '',
  'Faute de règlement du solde, nous avons le regret de vous informer que votre séjour {{propertyWithArticle}} est annulé.',
  '',
  'Séjour annulé :',
  '{{#if hasReservationNumber}}- N° de réservation : {{reservationNumber}}',
  '{{/if}}- Logement : {{propertyName}}',
  '- Arrivée  : le {{startDate}}',
  '- Départ   : le {{endDate}}',
  '',
  '{{#if hasRetainedDeposit}}Conformément à nos conditions, l\'acompte de {{retainedDepositAmount}} déjà versé reste acquis à titre d\'indemnité. Aucune autre somme ne vous sera réclamée.',
  '',
  '{{/if}}Vos dates sont désormais remises à la vente.',
  '',
  'Si cette annulation résulte d\'une erreur ou si vous souhaitez reprogrammer votre séjour, contactez-nous : nous restons à votre disposition au {{companyPhone}}.',
  '',
  'Bien à vous,',
  '{{senderName}}',
].join('\n');

const CANCELLATION_NOTICE_BODY_EN = [
  'Hello {{clientFirstName}},',
  '',
  'As the balance was not paid, we are sorry to inform you that your stay at {{propertyWithArticle}} has been cancelled.',
  '',
  'Cancelled stay:',
  '{{#if hasReservationNumber}}- Reservation no.: {{reservationNumber}}',
  '{{/if}}- Property : {{propertyName}}',
  '- Arrival  : {{startDate}}',
  '- Departure: {{endDate}}',
  '',
  '{{#if hasRetainedDeposit}}In accordance with our terms, the deposit of {{retainedDepositAmount}} already paid is retained as compensation. No further amount will be claimed.',
  '',
  '{{/if}}Your dates are now back on sale.',
  '',
  'If this cancellation is a mistake, or if you would like to reschedule, please contact us at {{companyPhone}}.',
  '',
  'Kind regards,',
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
  Object.freeze({
    stableKey: 'deposit_request',
    name:      'Demande d\'acompte (lien de paiement)',
    subject:   'Réglez l\'acompte pour confirmer votre séjour {{propertyWithArticle}}',
    body:      DEPOSIT_REQUEST_BODY,
    subjectEn: 'Pay the deposit to confirm your stay at {{propertyWithArticle}}',
    bodyEn:    DEPOSIT_REQUEST_BODY_EN,
    dayOffset: 0,          // sentinel — action-triggered (host « Envoyer la demande d'acompte »)
    sendMode:  'manual',   // sent by the host action, excluded from queue/cron (EVENT_TRIGGERED_STABLE_KEYS)
    enabled:   true,
  }),
  Object.freeze({
    stableKey: 'deposit_reminder',
    name:      "Relance acompte (à l'échéance)",
    subject:   "Votre acompte {{propertyWithArticle}} n'a pas été reçu",
    body:      DEPOSIT_REMINDER_BODY,
    subjectEn: 'Your deposit for {{propertyWithArticle}} has not been received',
    bodyEn:    DEPOSIT_REMINDER_BODY_EN,
    anchor:    'depositDueDate', // the acompte's own deadline, anchored on the booking day (spec §3.1)
    dayOffset: 0,                // fires ON the due date
    sendMode:  'manual',         // rule 44 — money is never chased by a cron; it lands in the queue
    enabled:   true,
  }),
  Object.freeze({
    stableKey: 'balance_reminder',
    name:      'Relance solde (avant annulation)',
    subject:   'Solde en attente pour votre séjour {{propertyWithArticle}}',
    body:      BALANCE_REMINDER_BODY,
    subjectEn: 'Balance pending for your stay at {{propertyWithArticle}}',
    bodyEn:    BALANCE_REMINDER_BODY_EN,
    anchor:    'balanceDueDate',
    dayOffset: 3,                // 3 days after the solde deadline, before the 7-day cancellation one
    sendMode:  'manual',         // rule 44 — same: proposed in the queue, sent by the operator
    enabled:   true,
  }),
  Object.freeze({
    stableKey: 'cancellation_notice',
    name:      "Avis d'annulation (acompte conservé)",
    subject:   'Annulation de votre séjour {{propertyWithArticle}}',
    body:      CANCELLATION_NOTICE_BODY,
    subjectEn: 'Cancellation of your stay at {{propertyWithArticle}}',
    bodyEn:    CANCELLATION_NOTICE_BODY_EN,
    dayOffset: 0,          // sentinel — sent when the operator confirms the cancellation
    sendMode:  'manual',   // excluded from the queue/cron (EVENT_TRIGGERED_STABLE_KEYS)
    enabled:   true,
  }),
  Object.freeze({
    stableKey: 'balance_request',
    name:      'Demande de solde (lien de paiement)',
    subject:   'Réglez le solde de votre séjour {{propertyWithArticle}}',
    body:      BALANCE_REQUEST_BODY,
    subjectEn: 'Pay the balance for your stay at {{propertyWithArticle}}',
    bodyEn:    BALANCE_REQUEST_BODY_EN,
    dayOffset: 0,          // sentinel — event-triggered (daily balance cron at the due date + host action)
    sendMode:  'manual',   // excluded from the manual queue/auto cron (EVENT_TRIGGERED_STABLE_KEYS)
    enabled:   true,
  }),
  // ───────────────────────────────────────────────────────────────────────────────
  // Add new default templates below. One object per template; follow the contract
  // documented at the top of this file. Re-uses any of the variables / flags listed in
  // `utils/emailContextBuilder.js`. Add a matching test case in
  // `tests/default-email-templates-seed.unit.test.js` so the seed coverage stays exhaustive.
  // ───────────────────────────────────────────────────────────────────────────────
]);

// Templates sent programmatically (on a payment event) or by an explicit host action — NOT by the
// date-driven manual queue (emailLogModel.listPending) nor the `auto` cron. Single source of truth so
// the model's exclusion and the senders stay in sync.
const EVENT_TRIGGERED_STABLE_KEYS = Object.freeze(['reservation_confirmation', 'deposit_request', 'balance_request', 'cancellation_notice']);

// Every template that asks a guest for money (specs/payment-schedule-and-cancellation.md §1 amendment,
// rule 44). None of them may ever carry `sendMode: 'auto'`: a dunning email is a commercial act the
// server cannot judge — it cannot know the acompte arrived by transfer this morning or that a delay was
// agreed by phone. A request leaves on an operator click (dashboard card / reservation page); a reminder
// waits in the manual queue. A new money template joins this list, and the seed test enforces the rule.
const PAYMENT_STABLE_KEYS = Object.freeze(['deposit_request', 'deposit_reminder', 'balance_request', 'balance_reminder']);

module.exports = {
  DEFAULT_TEMPLATES,
  EVENT_TRIGGERED_STABLE_KEYS,
  PAYMENT_STABLE_KEYS,
  // Exposed verbatim for tests that need the same body string the seed inserts.
  ARRIVAL_REMINDER_7D_BODY,
  ARRIVAL_REMINDER_1D_BODY,
  ARRIVAL_REMINDER_7D_BODY_EN,
  ARRIVAL_REMINDER_1D_BODY_EN,
};
