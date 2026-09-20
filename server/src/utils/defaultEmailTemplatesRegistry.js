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

// The six emails of the guest email sequence live in their own module (specs/guest-email-sequence.md
// §6.1). The historical constant names stay exported: migrations and tests key on them.
const SEQUENCE = require('./guestEmailSequenceTemplates');

const ARRIVAL_REMINDER_7D_BODY = SEQUENCE.J7_BODY;
const ARRIVAL_REMINDER_1D_BODY = SEQUENCE.J2_BODY;
const ARRIVAL_REMINDER_7D_BODY_EN = SEQUENCE.J7_BODY_EN;
const ARRIVAL_REMINDER_1D_BODY_EN = SEQUENCE.J2_BODY_EN;
const RESERVATION_CONFIRMATION_BODY = SEQUENCE.CONFIRMATION_BODY;
const RESERVATION_CONFIRMATION_BODY_EN = SEQUENCE.CONFIRMATION_BODY_EN;

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

// Full-payment request — a last-minute stay owes ONE payment, so there is no acompte to ask for
// (specs/deposit-blocks-the-dates.md rules 8 + 11). `{{paymentAmount}}` is the amount the Qonto link
// actually charges, injected per-send like `{{paymentLink}}`.
const FULL_REQUEST_BODY = [
  'Bonjour {{clientFirstName}},',
  '',
  'Votre séjour {{propertyWithArticle}} approche : il se règle en une seule fois, en ligne.',
  '',
  'Récapitulatif de votre séjour :',
  '- Logement : {{propertyName}}',
  '- Arrivée  : le {{startDate}} à partir de {{checkInTime}}',
  '- Départ   : le {{endDate}} avant {{checkOutTime}}',
  '{{#if hasReservedOptions}}- Option(s) : {{reservedOptionsList}}',
  '{{/if}}{{#if hasResources}}- Équipements : {{resourcesList}}',
  '{{/if}}',
  'Montant à régler : {{paymentAmount}}',
  '',
  'Payer en ligne : {{paymentLink}}',
  '',
  'Important : le règlement bloque vos dates. Tant qu\'il n\'est pas payé, les dates restent disponibles et peuvent être réservées par un autre client.',
  '',
  'Pour toute question, répondez simplement à cet email ou appelez-nous au {{companyPhone}}.',
  '',
  'À très bientôt,',
  '{{senderName}}',
].join('\n');

const FULL_REQUEST_BODY_EN = [
  'Hello {{clientFirstName}},',
  '',
  'Your stay at {{propertyWithArticle}} is coming up: it is settled in a single online payment.',
  '',
  'Summary of your stay:',
  '- Property : {{propertyName}}',
  '- Arrival  : {{startDate}} from {{checkInTime}}',
  '- Departure: {{endDate}} before {{checkOutTime}}',
  '{{#if hasReservedOptions}}- Option(s): {{reservedOptionsList}}',
  '{{/if}}{{#if hasResources}}- Equipment: {{resourcesList}}',
  '{{/if}}',
  'Amount to pay: {{paymentAmount}}',
  '',
  'Pay online: {{paymentLink}}',
  '',
  'Important: paying secures your dates. Until it is paid, they remain available and may be booked by another guest.',
  '',
  'For any question, simply reply to this email or call us at {{companyPhone}}.',
  '',
  'See you soon,',
  '{{senderName}}',
].join('\n');

const DEFAULT_TEMPLATES = Object.freeze([
  // Guest email sequence (specs/guest-email-sequence.md §3.1). `sendMode` is informative for these
  // six: they are scheduled by utils/guestEmailSequenceRunner and sent through the ledger, never by
  // the legacy dayOffset pass nor the pending queue once automatic sending is on (rule 19).
  Object.freeze({
    stableKey: 'arrival_reminder_7d',
    name:      'Séquence — J-7 préparation',
    subject:   SEQUENCE.J7_SUBJECT,
    body:      ARRIVAL_REMINDER_7D_BODY,
    subjectEn: SEQUENCE.J7_SUBJECT_EN,
    bodyEn:    ARRIVAL_REMINDER_7D_BODY_EN,
    anchor:    'start',
    dayOffset: -7,
    sendMode:  'auto',
    enabled:   true,
  }),
  Object.freeze({
    stableKey: 'arrival_reminder_1d',
    name:      'Séquence — J-2 arrivée',
    subject:   SEQUENCE.J2_SUBJECT,
    body:      ARRIVAL_REMINDER_1D_BODY,
    subjectEn: SEQUENCE.J2_SUBJECT_EN,
    bodyEn:    ARRIVAL_REMINDER_1D_BODY_EN,
    anchor:    'start',
    dayOffset: -2,
    sendMode:  'auto',
    enabled:   true,
  }),
  Object.freeze({
    stableKey: 'reservation_confirmation',
    name:      'Séquence — Confirmation',
    subject:   SEQUENCE.CONFIRMATION_SUBJECT,
    body:      RESERVATION_CONFIRMATION_BODY,
    subjectEn: SEQUENCE.CONFIRMATION_SUBJECT_EN,
    bodyEn:    RESERVATION_CONFIRMATION_BODY_EN,
    anchor:    'created',  // the booking day (payment is taken at booking); also sent on payment
    dayOffset: 0,
    sendMode:  'auto',
    enabled:   true,
  }),
  Object.freeze({
    stableKey: 'guest_thanks_j1',
    name:      'Séquence — J+1 merci et avis',
    subject:   SEQUENCE.J1_SUBJECT,
    body:      SEQUENCE.J1_BODY,
    subjectEn: SEQUENCE.J1_SUBJECT_EN,
    bodyEn:    SEQUENCE.J1_BODY_EN,
    anchor:    'end',
    dayOffset: 1,
    sendMode:  'auto',
    enabled:   true,
  }),
  Object.freeze({
    stableKey: 'season_gift_vouchers',
    name:      'Séquence — Bons cadeau (15 novembre)',
    subject:   SEQUENCE.NOVEMBER_SUBJECT,
    body:      SEQUENCE.NOVEMBER_BODY,
    subjectEn: SEQUENCE.NOVEMBER_SUBJECT_EN,
    bodyEn:    SEQUENCE.NOVEMBER_BODY_EN,
    anchor:    'season',
    dayOffset: 0,
    sendMode:  'auto',
    enabled:   true,
  }),
  Object.freeze({
    stableKey: 'season_new_year',
    name:      'Séquence — Vœux et dates (6 janvier)',
    subject:   SEQUENCE.JANUARY_SUBJECT,
    body:      SEQUENCE.JANUARY_BODY,
    subjectEn: SEQUENCE.JANUARY_SUBJECT_EN,
    bodyEn:    SEQUENCE.JANUARY_BODY_EN,
    anchor:    'season',
    dayOffset: 0,
    sendMode:  'auto',
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
  Object.freeze({
    stableKey: 'full_request',
    name:      'Demande de paiement intégral (lien de paiement)',
    subject:   'Réglez votre séjour {{propertyWithArticle}} pour confirmer vos dates',
    body:      FULL_REQUEST_BODY,
    subjectEn: 'Pay for your stay at {{propertyWithArticle}} to confirm your dates',
    bodyEn:    FULL_REQUEST_BODY_EN,
    dayOffset: 0,          // sentinel — action-triggered (host « Envoyer la demande de paiement »)
    sendMode:  'manual',   // rule 11 — a request for money is never sent by a cron
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
const EVENT_TRIGGERED_STABLE_KEYS = Object.freeze(['reservation_confirmation', 'deposit_request', 'balance_request', 'full_request', 'cancellation_notice']);

// Every template that asks a guest for money (specs/payment-schedule-and-cancellation.md §1 amendment,
// rule 44). None of them may ever carry `sendMode: 'auto'`: a dunning email is a commercial act the
// server cannot judge — it cannot know the acompte arrived by transfer this morning or that a delay was
// agreed by phone. A request leaves on an operator click (dashboard card / reservation page); a reminder
// waits in the manual queue. A new money template joins this list, and the seed test enforces the rule.
const PAYMENT_STABLE_KEYS = Object.freeze(['deposit_request', 'deposit_reminder', 'balance_request', 'balance_reminder', 'full_request']);

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
