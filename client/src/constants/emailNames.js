/**
 * The name of every shipped guest email — client mirror of NAMES in server/src/utils/emailTimeline.js
 * (specs/guest-email-texts-made-simple.md rule 44). The server stays the authority on what each page
 * shows; this copy only lets the settings search understand the names an owner types
 * (specs/settings-rationalization.md rule 29). server/src/tests/email-names-mirror.unit.test.js
 * keeps the two lists identical.
 */
export const EMAIL_DISPLAY_NAMES = Object.freeze({
  reservation_confirmation: 'Confirmation',
  deposit_request: 'Demande d’acompte',
  deposit_reminder: 'Rappel d’acompte',
  full_request: 'Demande de paiement',
  balance_request: 'Demande de solde',
  balance_reminder: 'Rappel de solde',
  arrival_reminder_7d: 'Préparation du séjour',
  arrival_reminder_1d: 'Accès et arrivée',
  guest_thanks_j1: 'Merci et avis',
  season_gift_vouchers: 'Bons cadeaux',
  season_new_year: 'Vœux et dates',
  cancellation_notice: 'Avis d’annulation',
});
