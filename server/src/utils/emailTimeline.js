/**
 * One name per email, and its place in the stay (specs/guest-email-texts-made-simple.md rule 44 —
 * UI/UX review 2026-10-18, decision 12). Pure.
 *
 * A shipped email is named by what it is for (« Accès et arrivée »), never by an internal code
 * (« J-2 », « Séquence — J-2 arrivée »); its moment is its « Quand » sentence (utils/templateWhen.js).
 * A template of the operator's own keeps the name it was given. Every page shows the same name:
 * Emails › Modèles, « Textes des emails », the manual send dialog.
 *
 *   displayNameOf(template)   the name
 *   momentOf(template)        { id, label, rank } — where the email sits in the stay
 *   timeline(templates)       [{ id, label, templates: [...] }] in stay order, empty moments left out
 */

const { templateWhen } = require('./templateWhen');

const NAMES = Object.freeze({
  reservation_confirmation: 'Confirmation',
  deposit_request: 'Demande d’acompte',
  deposit_reminder: 'Rappel d’acompte',
  full_request: 'Demande de paiement',
  balance_request: 'Demande de solde',
  balance_reminder: 'Rappel de solde',
  installment_request: 'Demande d’échéance',
  arrival_reminder_7d: 'Préparation du séjour',
  arrival_reminder_1d: 'Accès et arrivée',
  guest_thanks_j1: 'Merci et avis',
  season_gift_vouchers: 'Bons cadeaux',
  season_new_year: 'Vœux et dates',
  cancellation_notice: 'Avis d’annulation',
  dates_unavailable_notice: 'Dates plus disponibles',
});

const MOMENTS = Object.freeze([
  { id: 'booking', label: 'À la réservation' },
  { id: 'before', label: 'Avant l’arrivée' },
  { id: 'during', label: 'Pendant le séjour' },
  { id: 'after', label: 'Après le départ' },
  { id: 'season', label: 'Saison' },
  { id: 'cancellation', label: 'Annulation' },
]);

// Within a moment, the order a guest receives the shipped emails.
const ORDER = Object.freeze([
  'reservation_confirmation', 'deposit_request', 'full_request', 'deposit_reminder', 'dates_unavailable_notice', 'balance_request', 'balance_reminder',
  'installment_request', 'arrival_reminder_7d', 'arrival_reminder_1d', 'guest_thanks_j1', 'season_gift_vouchers', 'season_new_year', 'cancellation_notice',
]);

function displayNameOf(template) {
  const t = template || {};
  return NAMES[t.stableKey] || String(t.name || '').trim();
}

function momentIdOf(template) {
  const t = template || {};
  if (t.stableKey === 'cancellation_notice') return 'cancellation';
  if (['deposit_request', 'balance_request', 'full_request', 'dates_unavailable_notice'].includes(t.stableKey)) return 'booking';
  // An installment falls due before the arrival, with the other payment emails of that moment.
  if (t.stableKey === 'installment_request') return 'before';
  const anchor = String(t.anchor || 'start');
  if (['created', 'depositDueDate', 'balanceDueDate', 'validUntil'].includes(anchor)) return 'booking';
  if (anchor === 'season') return 'season';
  if (anchor === 'end') return 'after';
  return Number(t.dayOffset || 0) < 0 ? 'before' : 'during';
}

function momentOf(template) {
  const id = momentIdOf(template);
  const rank = MOMENTS.findIndex((m) => m.id === id);
  return { id, label: MOMENTS[rank].label, rank };
}

/** Stay order: the moment, then the shipped order, then the day offset, then the name. */
function compare(a, b) {
  const rank = (t) => (ORDER.includes(t.stableKey) ? ORDER.indexOf(t.stableKey) : ORDER.length);
  return momentOf(a).rank - momentOf(b).rank
    || rank(a) - rank(b)
    || Number(a.dayOffset || 0) - Number(b.dayOffset || 0)
    || displayNameOf(a).localeCompare(displayNameOf(b), 'fr');
}

/** The templates grouped by moment, in stay order, each with its name and its « Quand ». */
function timeline(templates) {
  const sorted = [...(templates || [])].sort(compare);
  return MOMENTS
    .map((m) => ({
      id: m.id,
      label: m.label,
      templates: sorted.filter((t) => momentIdOf(t) === m.id),
    }))
    .filter((m) => m.templates.length);
}

module.exports = { displayNameOf, momentOf, timeline, compare, NAMES };
