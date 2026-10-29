/**
 * When a template leaves, as one sentence (specs/email-automation.md rule 16,
 * specs/guest-email-texts-made-simple.md rule 43 — UI/UX review 2026-10-18, decision 11). Pure.
 *
 *   templateWhenLabel(t)  « 2 jours avant l’arrivée », « À la réservation »… — the « Quand » of a list
 *   templateWhen(t)       { editable, anchor, anchorLabel, days, direction, label, sentence }
 *   describeWhen(input)   the operator's « Envoyé [n] jours [avant|après|le jour même de] <ancre> »
 *                         → { ok, offsetDays, sentence } | { ok: false, field, message }
 *
 * Only the day offset of a template the scheduler counts from is editable: a template of the
 * operator's own (arrival), the deposit and balance reminders (their due dates). The guest sequence
 * computes its own days (utils/guestEmailSequence.js) and the event emails leave on an action: their
 * sentence is fixed.
 */

const { SEQUENCE_STABLE_KEYS } = require('./guestEmailSequence');

const FIXED = Object.freeze({
  reservation_confirmation: 'à la réservation',
  arrival_reminder_7d: '7 jours avant l’arrivée',
  arrival_reminder_1d: '2 jours avant l’arrivée',
  guest_thanks_j1: 'le lendemain du départ',
  season_gift_vouchers: 'le 15 novembre',
  season_new_year: 'le 6 janvier',
  cancellation_notice: 'à l’annulation',
  deposit_request: 'à la demande',
  balance_request: 'à la demande',
  full_request: 'à la demande',
  installment_request: 'à chaque échéance, à la demande',
});

// The words of each anchor, after « avant » / « après », and for the day itself.
const ANCHORS = Object.freeze({
  start: { after: 'l’arrivée', dayOf: 'le jour de l’arrivée' },
  depositDueDate: { after: 'l’échéance de l’acompte', dayOf: 'le jour de l’échéance de l’acompte' },
  balanceDueDate: { after: 'l’échéance du solde', dayOf: 'le jour de l’échéance du solde' },
});
const EDITABLE_ANCHORS = Object.keys(ANCHORS);
const FIXED_ANCHOR_AFTER = Object.freeze({ installmentDueDate: 'l’échéance' });

const MAX_DAYS = 90;
const capitalised = (s) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

function phrase(offset, anchor) {
  const words = ANCHORS[anchor] || ANCHORS.start;
  const n = Number(offset || 0);
  if (n === 0) return words.dayOf;
  const days = Math.abs(n);
  return `${days} jour${days > 1 ? 's' : ''} ${n < 0 ? 'avant' : 'après'} ${words.after}`;
}

function fixedPhrase(template, anchor) {
  if (FIXED[template.stableKey]) return FIXED[template.stableKey];
  if (anchor === 'created') return 'à la réservation';
  if (anchor === 'season') return 'en saison';
  if (anchor === 'end') {
    const n = Number(template.dayOffset || 0);
    if (n === 1) return 'le lendemain du départ';
    return phrase(n, 'start').replace('l’arrivée', 'le départ');
  }
  if (anchor === 'validUntil') {
    const n = Number(template.dayOffset || 0);
    return n === 0 ? 'le jour de fin de validité du devis' : phrase(n, 'start').replace('l’arrivée', 'la fin de validité du devis');
  }
  if (!ANCHORS[anchor]) return 'à la demande';
  return null;
}

function templateWhen(template) {
  const t = template || {};
  const anchor = String(t.anchor || 'start');
  const fixed = fixedPhrase(t, anchor);
  const n = Number(t.dayOffset || 0);
  const text = fixed || phrase(n, anchor);
  return {
    editable: !fixed && !SEQUENCE_STABLE_KEYS.includes(t.stableKey),
    anchor,
    anchorLabel: (ANCHORS[anchor] || { after: FIXED_ANCHOR_AFTER[anchor] || ANCHORS.start.after }).after,
    days: Math.abs(n),
    direction: n < 0 ? 'before' : (n > 0 ? 'after' : 'same'),
    label: capitalised(text),
    sentence: `Envoyé ${text}`,
  };
}

function templateWhenLabel(template) {
  return templateWhen(template).label;
}

/**
 * The operator's sentence → the stored signed offset. `days` is what was typed (a string or a
 * number), `direction` 'before' | 'after' | 'same'. A refusal names its field, in words.
 */
function describeWhen({ days, direction, anchor = 'start' } = {}) {
  const words = ANCHORS[anchor] ? anchor : 'start';
  if (direction === 'same') return { ok: true, offsetDays: 0, sentence: `Envoyé ${phrase(0, words)}` };
  if (direction !== 'before' && direction !== 'after') return { ok: false, field: 'direction', message: 'Choisir avant ou après.' };
  const raw = String(days == null ? '' : days).trim();
  if (!raw) return { ok: false, field: 'days', message: 'Indiquer un nombre de jours.' };
  if (!/^\d+$/.test(raw)) return { ok: false, field: 'days', message: 'Un nombre entier de jours, sans signe.' };
  const n = Number(raw);
  if (n === 0) return { ok: false, field: 'days', message: '0 jour : choisir « le jour même de ».' };
  if (n > MAX_DAYS) return { ok: false, field: 'days', message: `${MAX_DAYS} jours au plus.` };
  const offsetDays = direction === 'before' ? -n : n;
  return { ok: true, offsetDays, sentence: `Envoyé ${phrase(offsetDays, words)}` };
}

module.exports = { templateWhenLabel, templateWhen, describeWhen, MAX_DAYS };
